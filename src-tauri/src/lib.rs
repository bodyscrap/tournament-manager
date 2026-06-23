use tauri::{AppHandle, Emitter, Manager};
use tokio::net::UdpSocket;
use tokio::time::{sleep, Duration};

/// UDP ブロードキャストで使用するポート番号。
/// 動的ポート範囲 (49152–65535) 内を選択しており、一般的なゲームサーバーとの衝突を避けられる。
const UDP_PORT: u16 = 49777;

/// LAN ブロードキャスト送信先アドレス。
const BROADCAST_ADDR: &str = "255.255.255.255";

/// パケット再送間隔 (ms)。
/// LAN 環境での UDP パケットロス対策として、50ms 間隔で 3 回送信する。
const RETRY_INTERVAL_MS: u64 = 50;

/// UDP 受信タスク。アプリ起動時にバックグラウンドで起動し、常時待ち受けを行う。
/// 受信した JSON 文字列はそのままフロントエンドへ "udp-received" イベントとして流す。
async fn start_udp_listener(app: AppHandle) {
    let socket = match UdpSocket::bind(format!("0.0.0.0:{}", UDP_PORT)).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[UDP] Failed to bind port {}: {}", UDP_PORT, e);
            return;
        }
    };

    if let Err(e) = socket.set_broadcast(true) {
        eprintln!("[UDP] Failed to set broadcast: {}", e);
        return;
    }

    println!("[UDP] Listening on port {}", UDP_PORT);

    let mut buf = vec![0u8; 65535];
    loop {
        match socket.recv_from(&mut buf).await {
            Ok((len, addr)) => {
                let payload = String::from_utf8_lossy(&buf[..len]).to_string();
                println!("[UDP] Received {} bytes from {}", len, addr);
                if let Err(e) = app.emit("udp-received", &payload) {
                    eprintln!("[UDP] Failed to emit event: {}", e);
                }
            }
            Err(e) => {
                eprintln!("[UDP] Receive error: {}", e);
            }
        }
    }
}

/// フロントエンドから呼び出せる UDP ブロードキャスト送信コマンド。
/// パケットロス対策として、50ms 間隔で同一ペイロードを 3 回送信する。
#[tauri::command]
async fn send_udp_broadcast(payload: String) -> Result<(), String> {
    let socket = UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("Failed to bind send socket: {}", e))?;

    socket
        .set_broadcast(true)
        .map_err(|e| format!("Failed to set broadcast: {}", e))?;

    let target = format!("{}:{}", BROADCAST_ADDR, UDP_PORT);

    for i in 0u8..3 {
        socket
            .send_to(payload.as_bytes(), &target)
            .await
            .map_err(|e| format!("Failed to send UDP packet (attempt {}): {}", i + 1, e))?;

        if i < 2 {
            sleep(Duration::from_millis(RETRY_INTERVAL_MS)).await;
        }
    }

    println!("[UDP] Broadcast sent ({} bytes, 3x)", payload.len());
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
        .invoke_handler(tauri::generate_handler![send_udp_broadcast])
        .setup(|app| {
            let app_handle = app.handle().clone();
            // UDP 受信タスクを Tauri の非同期ランタイム（tokio）上で起動する
            tauri::async_runtime::spawn(start_udp_listener(app_handle));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


