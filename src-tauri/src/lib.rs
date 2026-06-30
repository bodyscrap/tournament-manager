use std::net::{Ipv4Addr, SocketAddr, UdpSocket as StdUdpSocket};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri::async_runtime::JoinHandle;
use tokio::net::UdpSocket;
use tokio::sync::{Mutex, RwLock};
use tokio::time::{sleep, Duration};

/// UDP ブロードキャストで使用するポート番号。
/// 動的ポート範囲 (49152–65535) 内を選択しており、一般的なゲームサーバーとの衝突を避けられる。
const DEFAULT_UDP_PORT: u16 = 49777;

/// LAN ブロードキャスト送信先アドレス。
const FALLBACK_BROADCAST_ADDR: &str = "255.255.255.255";

/// デフォルトのサブネットマスク。
const DEFAULT_SUBNET_MASK: &str = "255.255.255.0";

/// パケット再送間隔 (ms)。
/// LAN 環境での UDP パケットロス対策として、50ms 間隔で 3 回送信する。
const RETRY_INTERVAL_MS: u64 = 50;

#[derive(Serialize)]
struct UdpReceivedEvent {
    payload: String,
    sender_ip: String,
}

#[derive(Clone, Copy)]
struct UdpRuntimeSettings {
    subnet_mask: Ipv4Addr,
    port: u16,
}

struct UdpAppState {
    settings: RwLock<UdpRuntimeSettings>,
    listener_task: Mutex<Option<JoinHandle<()>>>,
}

impl UdpAppState {
    fn new() -> Self {
        Self {
            settings: RwLock::new(UdpRuntimeSettings {
                subnet_mask: DEFAULT_SUBNET_MASK.parse().unwrap_or(Ipv4Addr::new(255, 255, 255, 0)),
                port: DEFAULT_UDP_PORT,
            }),
            listener_task: Mutex::new(None),
        }
    }
}

fn parse_subnet_mask(value: &str) -> Result<Ipv4Addr, String> {
    let mask = value
        .parse::<Ipv4Addr>()
        .map_err(|_| "Invalid subnet mask format".to_string())?;
    let bits = u32::from(mask);
    // 1 が連続した後に 0 が連続するマスクのみ許可する。
    if bits != 0 && (bits | (bits - 1)) != u32::MAX {
        return Err("Invalid subnet mask bit pattern".to_string());
    }
    Ok(mask)
}

fn detect_local_ipv4() -> Option<Ipv4Addr> {
    let socket = StdUdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    match socket.local_addr().ok()? {
        SocketAddr::V4(v4) => Some(*v4.ip()),
        SocketAddr::V6(_) => None,
    }
}

fn resolve_broadcast_addr(mask: Ipv4Addr) -> Ipv4Addr {
    if let Some(local_ip) = detect_local_ipv4() {
        let local_bits = u32::from(local_ip);
        let mask_bits = u32::from(mask);
        let broadcast_bits = local_bits | !mask_bits;
        return Ipv4Addr::from(broadcast_bits);
    }
    FALLBACK_BROADCAST_ADDR
        .parse()
        .unwrap_or(Ipv4Addr::new(255, 255, 255, 255))
}

/// 現在のローカル IPv4 アドレスを取得する。
#[tauri::command]
fn get_local_ipv4() -> Option<String> {
    detect_local_ipv4().map(|ip| ip.to_string())
}

/// UDP 受信タスク。アプリ起動時にバックグラウンドで起動し、常時待ち受けを行う。
/// 受信した JSON 文字列はそのままフロントエンドへ "udp-received" イベントとして流す。
async fn start_udp_listener(app: AppHandle, port: u16) {
    let socket = match UdpSocket::bind(format!("0.0.0.0:{}", port)).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[UDP] Failed to bind port {}: {}", port, e);
            return;
        }
    };

    if let Err(e) = socket.set_broadcast(true) {
        eprintln!("[UDP] Failed to set broadcast: {}", e);
        return;
    }

    println!("[UDP] Listening on port {}", port);

    let mut buf = vec![0u8; 65535];
    loop {
        match socket.recv_from(&mut buf).await {
            Ok((len, addr)) => {
                let payload = String::from_utf8_lossy(&buf[..len]).to_string();
                println!("[UDP] Received {} bytes from {}", len, addr);
                let event = UdpReceivedEvent {
                    payload,
                    sender_ip: addr.ip().to_string(),
                };
                if let Err(e) = app.emit("udp-received", &event) {
                    eprintln!("[UDP] Failed to emit event: {}", e);
                }
            }
            Err(e) => {
                eprintln!("[UDP] Receive error: {}", e);
            }
        }
    }
}

async fn restart_udp_listener(app: AppHandle, state: &UdpAppState, port: u16) {
    {
        let mut guard = state.listener_task.lock().await;
        if let Some(handle) = guard.take() {
            handle.abort();
        }
        let app_handle = app.clone();
        let new_handle = tauri::async_runtime::spawn(async move {
            start_udp_listener(app_handle, port).await;
        });
        *guard = Some(new_handle);
    }
}

/// フロントエンドから呼び出せる UDP ネットワーク設定反映コマンド。
/// ポート変更時は受信リスナーを再起動し、サブネットマスクは送信先の算出に使用する。
#[tauri::command]
async fn configure_udp_network(
    app: AppHandle,
    state: State<'_, UdpAppState>,
    subnet_mask: String,
    port: u16,
) -> Result<(), String> {
    if port == 0 {
        return Err("Port must be 1-65535".to_string());
    }
    let parsed_mask = parse_subnet_mask(&subnet_mask)?;

    let previous_port = {
        let mut settings = state.settings.write().await;
        let old_port = settings.port;
        settings.subnet_mask = parsed_mask;
        settings.port = port;
        old_port
    };

    if previous_port != port {
        restart_udp_listener(app, &state, port).await;
    }

    Ok(())
}

/// フロントエンドから呼び出せる UDP ブロードキャスト送信コマンド。
/// パケットロス対策として、50ms 間隔で同一ペイロードを 3 回送信する。
#[tauri::command]
async fn send_udp_broadcast(
    state: State<'_, UdpAppState>,
    payload: String,
) -> Result<(), String> {
    let socket = UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("Failed to bind send socket: {}", e))?;

    socket
        .set_broadcast(true)
        .map_err(|e| format!("Failed to set broadcast: {}", e))?;

    let settings = *state.settings.read().await;
    let broadcast_addr = resolve_broadcast_addr(settings.subnet_mask);
    let primary_target = format!("{}:{}", broadcast_addr, settings.port);
    let fallback_target = format!("{}:{}", FALLBACK_BROADCAST_ADDR, settings.port);

    let targets = if primary_target == fallback_target {
        vec![primary_target]
    } else {
        vec![primary_target, fallback_target]
    };

    for i in 0u8..3 {
        for target in &targets {
            socket
                .send_to(payload.as_bytes(), target)
                .await
                .map_err(|e| format!("Failed to send UDP packet to {} (attempt {}): {}", target, i + 1, e))?;
        }

        if i < 2 {
            sleep(Duration::from_millis(RETRY_INTERVAL_MS)).await;
        }
    }

    println!("[UDP] Broadcast sent ({} bytes, 3x, targets: {:?})", payload.len(), targets);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            send_udp_broadcast,
            configure_udp_network,
            get_local_ipv4
        ])
        .setup(|app| {
            app.manage(UdpAppState::new());

            let app_handle = app.handle().clone();
            // UDP 受信タスクを Tauri の非同期ランタイム（tokio）上で起動する
            tauri::async_runtime::spawn(async move {
                let state_owner = app_handle.clone();
                let state = state_owner.state::<UdpAppState>();
                let port = state.settings.read().await.port;
                restart_udp_listener(app_handle.clone(), &state, port).await;
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


