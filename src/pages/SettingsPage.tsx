import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppContext } from "../context/AppContext";

function isValidSubnetMask(value: string): boolean {
  const segments = value.split(".");
  if (segments.length !== 4) return false;

  const octets: number[] = [];
  for (const segment of segments) {
    if (!/^\d{1,3}$/.test(segment)) return false;
    const octet = Number(segment);
    if (octet < 0 || octet > 255) return false;
    octets.push(octet);
  }

  const binary = octets.map((octet) => octet.toString(2).padStart(8, "0")).join("");
  return /^1*0*$/.test(binary);
}

export function SettingsPage() {
  const { networkMessageSettings, updateNetworkMessageSettings } = useAppContext();

  const [subnetMaskInput, setSubnetMaskInput] = useState(networkMessageSettings.subnetMask);
  const [portInput, setPortInput] = useState(String(networkMessageSettings.port));
  const [localIp, setLocalIp] = useState<string>("-");
  const [ipLoading, setIpLoading] = useState(false);
  const [ipError, setIpError] = useState("");
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const fetchLocalIp = async () => {
    setIpLoading(true);
    setIpError("");
    try {
      const ip = await invoke<string | null>("get_local_ipv4");
      setLocalIp(ip ?? "取得できません");
      if (!ip) {
        setIpError("ローカルIPを取得できませんでした");
      }
    } catch {
      setLocalIp("取得できません");
      setIpError("ローカルIPの取得に失敗しました");
    } finally {
      setIpLoading(false);
    }
  };

  useEffect(() => {
    setSubnetMaskInput(networkMessageSettings.subnetMask);
    setPortInput(String(networkMessageSettings.port));
  }, [networkMessageSettings.subnetMask, networkMessageSettings.port]);

  useEffect(() => {
    void fetchLocalIp();
  }, []);

  const handleSave = () => {
    const normalizedMask = subnetMaskInput.trim();
    if (!isValidSubnetMask(normalizedMask)) {
      setError("サブネットマスクの形式が不正です (例: 255.255.255.0)");
      return;
    }

    const port = Number(portInput);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError("ポートは 1 から 65535 の整数で入力してください");
      return;
    }

    setError("");
    updateNetworkMessageSettings({
      subnetMask: normalizedMask,
      port,
    });
    setSavedAt(new Date().toLocaleTimeString("ja-JP", { hour12: false }));
  };

  return (
    <div className="p-6 md:p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900">設定</h1>
      <p className="text-sm text-gray-500 mt-1">ネットワークとメッセージ関連の動作を設定します。</p>

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-5">
        <div>
          <label htmlFor="subnet-mask" className="block text-sm font-medium text-gray-700 mb-1">
            サブネットマスク
          </label>
          <input
            id="subnet-mask"
            type="text"
            placeholder="255.255.255.0"
            value={subnetMaskInput}
            onChange={(e) => setSubnetMaskInput(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="message-port" className="block text-sm font-medium text-gray-700 mb-1">
            ポート
          </label>
          <input
            id="message-port"
            type="number"
            min={1}
            max={65535}
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <div>
          <p className="block text-sm font-medium text-gray-700 mb-1">現在のローカルIP</p>
          <div className="flex items-center gap-2">
            <p className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono bg-gray-50 text-gray-700">
              {localIp}
            </p>
            <button
              type="button"
              onClick={() => {
                void fetchLocalIp();
              }}
              disabled={ipLoading}
              className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-60"
            >
              {ipLoading ? "取得中..." : "現在のIPを取得"}
            </button>
          </div>
          {ipError && <p className="text-xs text-amber-700 mt-1">{ipError}</p>}
        </div>

        <div className="pt-1">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={networkMessageSettings.saveUnmatchedMessages}
              onChange={(e) =>
                updateNetworkMessageSettings({ saveUnmatchedMessages: e.target.checked })
              }
              className="h-4 w-4 rounded border-gray-300"
            />
            未処理メッセージを保存する
          </label>
          <p className="text-xs text-gray-500 mt-1">デフォルト: ON</p>
        </div>

        <div className="pt-1">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={networkMessageSettings.preventUnresolvedThreadDeletion}
              onChange={(e) =>
                updateNetworkMessageSettings({ preventUnresolvedThreadDeletion: e.target.checked })
              }
              className="h-4 w-4 rounded border-gray-300"
            />
            未解決スレッドの削除を禁止する
          </label>
          <p className="text-xs text-gray-500 mt-1">デフォルト: ON</p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            保存
          </button>
          {savedAt && <span className="text-xs text-gray-500">{savedAt} に保存しました</span>}
        </div>
      </section>
    </div>
  );
}
