import { useNavigate } from "react-router-dom";
import { useAppContext } from "../context/AppContext";
import type { Tournament } from "../lib/types";

// ── Status badge ─────────────────────────────────────────────────
function StatusBadge({ status }: { status: Tournament["status"] }) {
  const cfg: Record<Tournament["status"], { label: string; cls: string }> = {
    setup: { label: "設定中", cls: "bg-yellow-100 text-yellow-700" },
    in_progress: { label: "進行中", cls: "bg-green-100 text-green-700" },
    completed: { label: "完了 (未確定)", cls: "bg-blue-100 text-blue-700" },
    finalized: { label: "結果確定済", cls: "bg-gray-200 text-gray-500" },
  };
  const { label, cls } = cfg[status];
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>
      {label}
    </span>
  );
}

// ── Tournament card ───────────────────────────────────────────────
function TournamentCard({
  t,
  isActive,
  onClick,
}: {
  t: Tournament;
  isActive: boolean;
  onClick: () => void;
}) {
  const typeLabel =
    t.type === "single_elimination"
      ? "シングルエリミネーション"
      : "ダブルエリミネーション";
  const date = new Date(t.created_at).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-xl border-2 transition-colors ${
        isActive
          ? "border-blue-500 bg-blue-50"
          : "border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/50"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 truncate">{t.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">{typeLabel} · {date}</p>
        </div>
        <StatusBadge status={t.status} />
      </div>
      {isActive && (
        <p className="mt-2 text-xs text-blue-600 font-medium">▶ 選択中</p>
      )}
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────
export function HomePage() {
  const { tournamentList, tournament, selectTournament } = useAppContext();
  const navigate = useNavigate();

  const handleSelect = async (t: Tournament) => {
    await selectTournament(t.id);
    if (t.status === "setup") {
      navigate("/tournament/setup");
    } else {
      navigate("/tournament/bracket");
    }
  };

  const handleCreateNew = async () => {
    // Deselect current tournament so setup page shows create form
    await selectTournament(null);
    navigate("/tournament/setup");
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">大会一覧</h2>
        <button
          onClick={handleCreateNew}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
        >
          ＋ 新規作成
        </button>
      </div>

      {tournamentList.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-5xl mb-4">🏆</p>
          <p className="text-sm mb-5">大会がまだ作成されていません</p>
          <button
            onClick={handleCreateNew}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
          >
            最初の大会を作成する
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {tournamentList.map((t) => (
            <TournamentCard
              key={t.id}
              t={t}
              isActive={t.id === tournament?.id}
              onClick={() => handleSelect(t)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

