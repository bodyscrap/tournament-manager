import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppContext } from "../context/AppContext";
import { useMessageNotification } from "../hooks/useMessageNotification";
import type { ReceivedMessageEntry, SentMessageEntry } from "../hooks/useMessageNotification";
import type { MessageAttribute } from "../lib/types/notification";

const MAX_COMMENT_LEN = 300;

type Tab = "received" | "sent" | "unmatched";
type ComposeKind = "CALL" | "TOURNAMENT_ID_CHECK" | "GENERAL";

type PlayerOption = {
  playerId: string;
  playerId4: string;
  name: string;
  userCode: string;
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function attributeLabel(attribute: MessageAttribute): string {
  switch (attribute) {
    case "CALL":
      return "呼出";
    case "TOURNAMENT_ID_CHECK":
      return "大会ID確認";
    case "GENERAL":
      return "汎用";
    case "TOURNAMENT_ID_CHECK_RESULT":
      return "大会ID確認応答";
    default:
      return attribute;
  }
}

function parseTargetTournamentIds(value: string): string[] {
  return value
    .split(/[\n,\s]+/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function MessageCard({ entry }: { entry: ReceivedMessageEntry | SentMessageEntry }) {
  const message = entry.message;
  const sentTime = message.sentAt ?? message.timestamp;
  const receivedTime = message.receivedAt;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
              {attributeLabel(message.attribute)}
            </span>
            <p className="font-semibold text-gray-900 truncate">{message.title}</p>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            送信元: <span className="font-mono">{message.eventId}-{message.sourceTournamentId}</span>
            {" "}({message.sourceTournamentName})
          </p>
          {message.targetTournamentIds && message.targetTournamentIds.length > 0 && (
            <p className="text-xs text-gray-500 mt-0.5">
              宛先大会ID: <span className="font-mono">{message.targetTournamentIds.join(", ")}</span>
            </p>
          )}
        </div>
        <p className="text-xs text-gray-400 shrink-0">{fmtTime(sentTime)}</p>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
        <p>
          送信: <span className="font-mono">{fmtTime(sentTime)}</span>
        </p>
        {receivedTime && (
          <p>
            受信: <span className="font-mono">{fmtTime(receivedTime)}</span>
          </p>
        )}
      </div>

      <pre className="mt-3 text-sm text-gray-700 whitespace-pre-wrap break-words bg-gray-50 rounded-lg p-3">
        {message.body}
      </pre>

      {message.comment && (
        <div className="mt-2 text-sm text-gray-700">
          <p className="text-xs text-gray-400 mb-1">通信欄</p>
          <p className="whitespace-pre-wrap break-words">{message.comment}</p>
        </div>
      )}
    </div>
  );
}

function NewMessageDialog({
  playerOptions,
  tournamentName,
  eventCode,
  tournamentCode,
  tournamentStatus,
  initialKind,
  initialSelectedPlayerId,
  initialComment,
  onSend,
  onClose,
}: {
  playerOptions: PlayerOption[];
  tournamentName: string;
  eventCode: string;
  tournamentCode: string;
  tournamentStatus: "setup" | "in_progress" | "completed" | "finalized";
  initialKind?: ComposeKind;
  initialSelectedPlayerId?: string;
  initialComment?: string;
  onSend: (input: {
    attribute: MessageAttribute;
    title: string;
    body: string;
    comment?: string;
    targetTournamentIds?: string[];
    targetPlayerId?: string;
    targetPlayerName?: string;
    targetUserCode?: string;
    requestedTournamentId?: string;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const initialPlayerId =
    initialSelectedPlayerId && playerOptions.some((p) => p.playerId === initialSelectedPlayerId)
      ? initialSelectedPlayerId
      : playerOptions[0]?.playerId ?? "";

  const [kind, setKind] = useState<ComposeKind>(initialKind ?? "CALL");
  const [selectedPlayerId, setSelectedPlayerId] = useState(initialPlayerId);
  const [targetTournamentIdsInput, setTargetTournamentIdsInput] = useState("");
  const [comment, setComment] = useState(initialComment ?? "");
  const [generalTitle, setGeneralTitle] = useState("");
  const [requestedTournamentId, setRequestedTournamentId] = useState(tournamentCode);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (selectedPlayerId) {
      if (!playerOptions.some((p) => p.playerId === selectedPlayerId)) {
        setSelectedPlayerId(playerOptions[0]?.playerId ?? "");
      }
      return;
    }
    if (playerOptions.length > 0) {
      setSelectedPlayerId(playerOptions[0].playerId);
    }
  }, [playerOptions, selectedPlayerId]);

  const selectedPlayer = playerOptions.find((p) => p.playerId === selectedPlayerId) ?? null;

  const callTitle = `呼び出し:${tournamentName}`;
  const callBody = selectedPlayer
    ? `${eventCode}-${tournamentCode}:${tournamentName}\n${selectedPlayer.playerId4}:${selectedPlayer.name} の呼び出しです。\n会場までお越しください。`
    : "対象プレイヤーを選択してください。";

  const handleSubmit = async () => {
    setError("");

    const trimmedComment = comment.trim();
    if (trimmedComment.length > MAX_COMMENT_LEN) {
      setError("通信欄は 300 文字以下で入力してください");
      return;
    }

    const targetTournamentIds = parseTargetTournamentIds(targetTournamentIdsInput);

    try {
      setSending(true);

      if (kind === "CALL") {
        if (tournamentStatus !== "in_progress") {
          setError("呼出メッセージは進行中の大会でのみ送信できます");
          return;
        }
        if (!selectedPlayer) {
          setError("呼出対象のプレイヤーを選択してください");
          return;
        }

        await onSend({
          attribute: "CALL",
          title: callTitle,
          body: callBody,
          comment: trimmedComment || undefined,
          targetTournamentIds: targetTournamentIds.length > 0 ? targetTournamentIds : undefined,
          targetPlayerId: selectedPlayer.playerId,
          targetPlayerName: selectedPlayer.name,
          targetUserCode: selectedPlayer.userCode,
        });
        onClose();
        return;
      }

      if (kind === "TOURNAMENT_ID_CHECK") {
        if (tournamentStatus !== "in_progress") {
          setError("大会ID確認メッセージは進行中の大会でのみ送信できます");
          return;
        }
        const requestedId = requestedTournamentId.trim();
        if (!requestedId) {
          setError("確認対象の大会IDを入力してください");
          return;
        }

        const body = `${eventCode}-${tournamentCode}:${tournamentName}\n大会ID確認要求: ${requestedId}\n同一大会IDのクライアントは自動応答してください。`;
        await onSend({
          attribute: "TOURNAMENT_ID_CHECK",
          title: `大会ID確認:${tournamentName}`,
          body,
          comment: trimmedComment || undefined,
          requestedTournamentId: requestedId,
          targetTournamentIds: targetTournamentIds.length > 0 ? targetTournamentIds : undefined,
        });
        onClose();
        return;
      }

      const title = generalTitle.trim();
      if (!title) {
        setError("汎用メッセージのタイトルを入力してください");
        return;
      }

      if (tournamentStatus === "finalized") {
        setError("確定済みの大会には送信できません");
        return;
      }

      const body = "通信欄:\n" + (trimmedComment || "(未入力)");
      await onSend({
        attribute: "GENERAL",
        title,
        body,
        comment: trimmedComment || undefined,
        targetTournamentIds: targetTournamentIds.length > 0 ? targetTournamentIds : undefined,
      });
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl mx-4 bg-white rounded-xl shadow-xl p-6">
        <div className="flex items-center justify-between gap-2 mb-4">
          <h2 className="text-lg font-bold text-gray-900">📢 新しいメッセージを作成</h2>
          {error && (
            <div className="px-3 py-1 bg-red-50 border border-red-200 rounded-lg shrink-0">
              <p className="text-xs font-medium text-red-600 whitespace-nowrap">{error}</p>
            </div>
          )}
        </div>

        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">メッセージ属性</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
              value={kind}
              onChange={(e) => setKind(e.target.value as ComposeKind)}
            >
              <option value="CALL">呼出</option>
              <option value="TOURNAMENT_ID_CHECK">大会ID確認</option>
              <option value="GENERAL">汎用</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              宛先大会ID（任意・複数可、カンマ/改行区切り）
            </label>
            <textarea
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
              placeholder="例: T001, T005"
              value={targetTournamentIdsInput}
              onChange={(e) => setTargetTournamentIdsInput(e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-1">
              未入力の場合は無差別送信（ブロードキャスト）
            </p>
          </div>

          {kind === "CALL" && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">呼出対象プレイヤー</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                  value={selectedPlayerId}
                  onChange={(e) => setSelectedPlayerId(e.target.value)}
                >
                  {playerOptions.map((p) => (
                    <option key={p.playerId} value={p.playerId}>
                      {p.playerId4} / {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">タイトル（固定）</p>
                <p className="text-sm font-semibold text-gray-900 bg-gray-50 rounded-lg px-3 py-2">{callTitle}</p>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">基本メッセージ（固定）</p>
                <pre className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg px-3 py-2">
                  {callBody}
                </pre>
              </div>
            </>
          )}

          {kind === "TOURNAMENT_ID_CHECK" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">確認対象の大会ID</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                value={requestedTournamentId}
                onChange={(e) => setRequestedTournamentId(e.target.value)}
              />
            </div>
          )}

          {kind === "GENERAL" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">タイトル</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="例: 会場案内について"
                value={generalTitle}
                onChange={(e) => setGeneralTitle(e.target.value)}
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">通信欄（最大 300 文字）</label>
            <textarea
              rows={4}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT_LEN))}
            />
            <p className="text-xs text-gray-400 text-right">{comment.length} / {MAX_COMMENT_LEN}</p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="px-4 py-2 rounded-lg border border-gray-300 text-sm hover:bg-gray-50"
            onClick={onClose}
          >
            キャンセル
          </button>
          <button
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-60"
            onClick={handleSubmit}
            disabled={sending}
          >
            {sending ? "送信中..." : "送信"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function NotificationPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { tournament, participants } = useAppContext();
  const { receivedMessages, sentMessages, unmatchedMessages, sendMessage } = useMessageNotification();

  const [tab, setTab] = useState<Tab>("received");
  const [showCompose, setShowCompose] = useState(false);
  const [composePreset, setComposePreset] = useState<{
    kind?: ComposeKind;
    selectedPlayerId?: string;
    comment?: string;
  } | null>(null);

  const playerOptions = useMemo<PlayerOption[]>(() => {
    return [...participants]
      .sort((a, b) => a.seed - b.seed)
      .map((p) => ({
        playerId: p.player_id,
        playerId4: p.player_id_4,
        name: p.name,
        userCode: p.player_code,
      }));
  }, [participants]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("compose") !== "call") return;

    setComposePreset({
      kind: "CALL",
      selectedPlayerId: params.get("playerId") ?? undefined,
      comment: params.get("comment") ?? undefined,
    });
    setShowCompose(true);
    navigate("/notification", { replace: true });
  }, [location.search, navigate]);

  if (!tournament) {
    return (
      <div className="flex items-center justify-center h-full py-20 text-gray-400">
        <p className="text-sm">大会が選択されていません</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">📢 メッセージ</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            イベント: <span className="font-mono">{tournament.event_code}</span>
            {" / "}大会: <span className="font-mono">{tournament.tournament_code}</span>
          </p>
        </div>
        <button
          onClick={() => {
            setComposePreset(null);
            setShowCompose(true);
          }}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700"
        >
          + メッセージを作成
        </button>
      </div>

      <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1">
        <button
          onClick={() => setTab("received")}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
            tab === "received" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
          }`}
        >
          受信したメッセージ
        </button>
        <button
          onClick={() => setTab("sent")}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
            tab === "sent" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
          }`}
        >
          自分が送信したメッセージ
        </button>
        <button
          onClick={() => setTab("unmatched")}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
            tab === "unmatched" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
          }`}
        >
          未受理メッセージ
        </button>
      </div>

      {tab === "received" && (
        <div className="space-y-3">
          {receivedMessages.length === 0 && (
            <p className="text-center text-gray-400 py-12 text-sm">受信したメッセージはありません</p>
          )}
          {receivedMessages.map((entry) => (
            <MessageCard key={entry.message.messageId} entry={entry} />
          ))}
        </div>
      )}

      {tab === "sent" && (
        <div className="space-y-3">
          {sentMessages.length === 0 && (
            <p className="text-center text-gray-400 py-12 text-sm">送信したメッセージはありません</p>
          )}
          {sentMessages.map((entry) => (
            <MessageCard key={entry.message.messageId} entry={entry} />
          ))}
        </div>
      )}

      {tab === "unmatched" && (
        <div className="space-y-3">
          {unmatchedMessages.length === 0 && (
            <p className="text-center text-gray-400 py-12 text-sm">未受理メッセージはありません</p>
          )}
          {unmatchedMessages.map((entry) => (
            <MessageCard key={entry.message.messageId} entry={entry} />
          ))}
        </div>
      )}

      {showCompose && (
        <NewMessageDialog
          playerOptions={playerOptions}
          tournamentName={tournament.name}
          eventCode={tournament.event_code}
          tournamentCode={tournament.tournament_code}
          tournamentStatus={tournament.status}
          initialKind={composePreset?.kind}
          initialSelectedPlayerId={composePreset?.selectedPlayerId}
          initialComment={composePreset?.comment}
          onSend={sendMessage}
          onClose={() => {
            setShowCompose(false);
            setComposePreset(null);
          }}
        />
      )}
    </div>
  );
}
