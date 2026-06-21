import { useMemo, useState } from "react";
import { useAppContext } from "../context/AppContext";
import { SafeQRCode } from "../components/common/SafeQRCode";
import { exportA4SheetImages, exportSingleCardImage, type ExportCardItem } from "../lib/cardExport";

export function TournamentPlayerCardsPage() {
  const { tournament, participants, admins } = useAppContext();
  const [savingSingleId, setSavingSingleId] = useState<string | null>(null);
  const [savingSheets, setSavingSheets] = useState(false);

  if (!tournament) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center text-gray-500">
          大会が選択されていません。大会一覧から大会を選択してください。
        </div>
      </div>
    );
  }

  const sorted = [...participants].sort((a, b) => a.seed - b.seed);

  const allSheetItems = useMemo<ExportCardItem[]>(() => {
    const participantItems = [...participants]
      .sort((a, b) => a.seed - b.seed)
      .map((p) => ({
        entityType: "participant" as const,
        id: `participant:${p.player_id}`,
        name: p.name,
        userCode: p.player_code,
        eventCode: tournament.event_code,
        tournamentCode: tournament.tournament_code,
        tournamentName: tournament.name,
        qrPayload: p.player_code,
      }));

    const adminItems = [...admins]
      .sort((a, b) => a.admin_sequence - b.admin_sequence)
      .map((a) => ({
        entityType: "admin" as const,
        id: `admin:${a.admin_id}`,
        name: a.name,
        userCode: a.admin_code,
        eventCode: tournament.event_code,
        tournamentCode: tournament.tournament_code,
        tournamentName: tournament.name,
        qrPayload: a.admin_code,
      }));

    return [...participantItems, ...adminItems];
  }, [participants, admins, tournament]);

  const handleSaveSingle = async (item: ExportCardItem) => {
    setSavingSingleId(item.id);
    try {
      await exportSingleCardImage(item);
    } catch (err) {
      alert(err instanceof Error ? err.message : "カード画像の保存に失敗しました");
    } finally {
      setSavingSingleId(null);
    }
  };

  const handleSaveSheets = async () => {
    if (allSheetItems.length === 0) {
      alert("出力対象がありません。");
      return;
    }

    setSavingSheets(true);
    try {
      await exportA4SheetImages(allSheetItems, tournament.name);
    } catch (err) {
      alert(err instanceof Error ? err.message : "A4シート画像の保存に失敗しました");
    } finally {
      setSavingSheets(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-gray-800">参加者カード</h2>
        <p className="text-sm text-gray-500 mt-1">
          大会: {tournament.name} / コード: <span className="font-mono">{tournament.tournament_code}</span>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={handleSaveSheets}
            disabled={savingSheets || allSheetItems.length === 0}
            className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50"
          >
            {savingSheets ? "生成中..." : "全参加者+全管理者をA4シート画像で保存"}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">A4中央90%領域に5行×2列で配置し、10件ごとに1枚のPNGを保存します。</p>
      </div>

      {sorted.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center text-gray-500">
          参加者がまだ登録されていません。
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sorted.map((p) => {
            const qrData = p.player_code;

            return (
              <article key={p.player_id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-gray-800">{p.name}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Seed #{p.seed}</p>
                  </div>
                  <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 font-mono">
                    ID {p.player_id_4}
                  </span>
                </div>

                <div className="mt-3">
                  <p className="text-xs text-gray-500">プレイヤーコード</p>
                  <p className="font-mono text-sm text-gray-800 break-all">{p.player_code || "(未発行)"}</p>
                  <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                    大会コード: <span className="font-mono">{tournament.tournament_code}</span>
                    <br />
                    大会名: {tournament.name}
                  </p>
                </div>

                {p.character_name && (
                  <p className="mt-2 text-xs text-blue-700 bg-blue-50 inline-block px-2 py-0.5 rounded">
                    {p.character_name}
                  </p>
                )}

                <div className="mt-3 p-3 bg-gray-50 rounded-lg flex items-center justify-center">
                  <SafeQRCode value={qrData} size={132} />
                </div>

                <button
                  onClick={() =>
                    handleSaveSingle({
                      entityType: "participant",
                      id: `participant:${p.player_id}`,
                      name: p.name,
                      userCode: p.player_code,
                      eventCode: tournament.event_code,
                      tournamentCode: tournament.tournament_code,
                      tournamentName: tournament.name,
                      qrPayload: qrData,
                    })
                  }
                  disabled={savingSingleId !== null}
                  className="mt-3 w-full px-3 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
                >
                  {savingSingleId === `participant:${p.player_id}` ? "保存中..." : "画像保存"}
                </button>

                {Object.keys(p.attributes).length > 0 && (
                  <div className="mt-3 border-t border-gray-100 pt-2">
                    <p className="text-xs text-gray-500 mb-1">属性</p>
                    <div className="space-y-1">
                      {Object.entries(p.attributes).map(([k, v]) => (
                        <p key={k} className="text-xs text-gray-700 break-all">
                          <span className="font-medium">{k}:</span> {v}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
