import { useAppContext } from "../context/AppContext";
import { SafeQRCode } from "../components/common/SafeQRCode";

export function TournamentPlayerCardsPage() {
  const { tournament, participants } = useAppContext();

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

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-gray-800">参加者カード</h2>
        <p className="text-sm text-gray-500 mt-1">
          大会: {tournament.name} / コード: <span className="font-mono">{tournament.tournament_code}</span>
        </p>
      </div>

      {sorted.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center text-gray-500">
          参加者がまだ登録されていません。
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sorted.map((p) => {
            const qrData = JSON.stringify({
              entity_type: "participant",
              tournament_id: tournament.id,
              tournament_name: tournament.name,
              tournament_code: tournament.tournament_code,
              player_id: p.player_id,
              player_id_4: p.player_id_4,
              player_name: p.name,
              player_code: p.player_code,
              character_name: p.character_name,
              attributes: p.attributes,
            });

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
                </div>

                {p.character_name && (
                  <p className="mt-2 text-xs text-blue-700 bg-blue-50 inline-block px-2 py-0.5 rounded">
                    {p.character_name}
                  </p>
                )}

                <div className="mt-3 p-3 bg-gray-50 rounded-lg flex items-center justify-center">
                  <SafeQRCode value={qrData} size={132} />
                </div>

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
