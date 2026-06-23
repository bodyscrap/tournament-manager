import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { getVersion } from "@tauri-apps/api/app";
import { useAppContext } from "../../context/AppContext";
import { useMessageNotification } from "../../hooks/useMessageNotification";

const navItems = [
  { to: "/", label: "大会一覧", icon: "🏠" },
  { to: "/tournament/setup", label: "大会管理", icon: "⚙️" },
  { to: "/tournament/bracket", label: "ブラケット", icon: "🏆" },
  { to: "/character-lists", label: "アイテムリスト", icon: "📚" },
  { to: "/tournament/users", label: "ユーザーリスト", icon: "👥" },
  { to: "/notification", label: "メッセージ", icon: "📢" },
];

const STATUS_LABEL: Record<string, string> = {
  setup: "設定中",
  in_progress: "進行中",
  completed: "完了 (未確定)",
  finalized: "結果確定済",
};

const STATUS_COLOR: Record<string, string> = {
  setup: "text-yellow-400",
  in_progress: "text-green-400",
  completed: "text-blue-400",
  finalized: "text-gray-400",
};

export function Sidebar() {
  const { tournament, pinnedTournament, isReadOnly, selectTournament } = useAppContext();
  const { unreadReceivedCount } = useMessageNotification();
  const [appVersion, setAppVersion] = useState<string>("-");

  useEffect(() => {
    let mounted = true;
    void getVersion()
      .then((version) => {
        if (mounted) setAppVersion(version);
      })
      .catch(() => {
        if (mounted) setAppVersion("-");
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <aside className="w-56 shrink-0 bg-gray-900 text-white flex flex-col min-h-screen">
      <div className="px-4 py-5 border-b border-gray-700">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-bold tracking-wide">🥫 サバ管</h1>
          <span className="text-[11px] font-mono text-gray-400">v{appVersion}</span>
        </div>
        <p className="text-xs text-gray-400 mt-0.5">選択中の大会</p>
        {tournament && (
          <div className="mt-3 px-2 py-2 bg-gray-800 rounded-lg">
            <p className="text-xs text-white font-medium truncate">{tournament.name}</p>
            <p className={`text-xs mt-0.5 ${STATUS_COLOR[tournament.status]}`}>
              {isReadOnly ? "🔒 " : ""}{STATUS_LABEL[tournament.status]}
            </p>
            <p className="text-[11px] text-gray-400 mt-1">
              イベントID: <span className="font-mono">{tournament.event_code}</span>
            </p>
            <p className="text-[11px] text-gray-400">
              大会ID: <span className="font-mono">{tournament.tournament_code}</span>
            </p>
          </div>
        )}
        {pinnedTournament && (
          <button
            onClick={() => selectTournament(pinnedTournament.id)}
            className="mt-3 w-full px-2 py-2 bg-indigo-950/70 rounded-lg text-left hover:bg-indigo-900 transition-colors"
          >
            <p className="text-xs text-indigo-300 font-medium">📌 ピン留め中の大会</p>
            <p className="text-xs text-white font-medium truncate mt-1">{pinnedTournament.name}</p>
            <p className="text-[11px] text-indigo-200 mt-0.5">
              {pinnedTournament.status === "in_progress" ? "進行中" : pinnedTournament.status === "completed" ? "完了 (未確定)" : "結果確定済"}
            </p>
          </button>
        )}
      </div>
      <nav className="flex-1 px-2 py-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-gray-300 hover:bg-gray-800 hover:text-white"
              }`
            }
          >
            <span>{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {item.to === "/notification" && unreadReceivedCount > 0 && (
              <span className="ml-auto min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-[11px] font-bold leading-5 text-center">
                {unreadReceivedCount > 99 ? "99+" : unreadReceivedCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
