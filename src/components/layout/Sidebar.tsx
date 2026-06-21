import { NavLink } from "react-router-dom";
import { useAppContext } from "../../context/AppContext";

const navItems = [
  { to: "/", label: "大会一覧", icon: "🏠" },
  { to: "/character-lists", label: "アイテムリスト", icon: "📚" },
  { to: "/tournament/setup", label: "大会管理", icon: "⚙️" },
  { to: "/tournament/bracket", label: "ブラケット", icon: "🏆" },
  { to: "/tournament/users", label: "ユーザーリスト", icon: "👥" },
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
  const { tournament, isReadOnly } = useAppContext();

  return (
    <aside className="w-56 shrink-0 bg-gray-900 text-white flex flex-col min-h-screen">
      <div className="px-4 py-5 border-b border-gray-700">
        <h1 className="text-lg font-bold tracking-wide">🥫 サバ管</h1>
        <p className="text-xs text-gray-400 mt-0.5">選択中の大会</p>
        {tournament && (
          <div className="mt-3 px-2 py-2 bg-gray-800 rounded-lg">
            <p className="text-xs text-white font-medium truncate">{tournament.name}</p>
            <p className={`text-xs mt-0.5 ${STATUS_COLOR[tournament.status]}`}>
              {isReadOnly ? "🔒 " : ""}{STATUS_LABEL[tournament.status]}
            </p>
          </div>
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
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
