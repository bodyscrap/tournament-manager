import { useState } from "react";
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
  isPinned,
  onClick,
  onTogglePin,
  onDelete,
  deleting,
}: {
  t: Tournament;
  isActive: boolean;
  isPinned: boolean;
  onClick: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
  deleting: boolean;
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
    <div className="relative">
      <button
        onClick={onClick}
        disabled={deleting}
        className={`w-full text-left p-4 pr-20 rounded-xl border-2 transition-colors disabled:opacity-60 ${
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
        <div className="mt-2 flex items-center gap-2">
          {isActive && (
            <p className="text-xs text-blue-600 font-medium">▶ 選択中</p>
          )}
          {isPinned && (
            <p className="text-xs text-amber-600 font-medium">📌 ピン留め中</p>
          )}
        </div>
      </button>

      <button
        onClick={onTogglePin}
        disabled={deleting || t.status === "finalized"}
        className={`absolute bottom-3 right-3 px-2.5 py-1 text-xs font-medium rounded-md disabled:opacity-60 ${
          isPinned
            ? "bg-amber-100 hover:bg-amber-200 text-amber-700"
            : "bg-gray-100 hover:bg-gray-200 text-gray-700"
        }`}
      >
        {isPinned ? "ピン留め解除" : "この大会をピン留めする"}
      </button>

      <button
        onClick={onDelete}
        disabled={deleting}
        className="absolute top-3 right-3 px-2.5 py-1 text-xs font-medium rounded-md bg-red-100 hover:bg-red-200 text-red-700 disabled:opacity-60"
      >
        {deleting ? "削除中..." : "削除"}
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────
export function HomePage() {
  const {
    tournamentList,
    tournament,
    pinnedTournament,
    setPinnedTournament,
    selectTournament,
    removeTournament,
  } = useAppContext();
  const navigate = useNavigate();
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const handleDeleteTournament = async (t: Tournament) => {
    if (!confirm(`「${t.name}」を削除しますか？\nこの操作は取り消せません。`)) return;
    setDeletingId(t.id);
    try {
      await removeTournament(t.id);
    } finally {
      setDeletingId(null);
    }
  };

  const handleTogglePin = async (t: Tournament) => {
    if (t.id === pinnedTournament?.id) {
      await setPinnedTournament(null);
      return;
    }
    await setPinnedTournament(t.id);
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
              isPinned={t.id === pinnedTournament?.id}
              onClick={() => handleSelect(t)}
              onTogglePin={() => handleTogglePin(t)}
              onDelete={() => handleDeleteTournament(t)}
              deleting={deletingId === t.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

