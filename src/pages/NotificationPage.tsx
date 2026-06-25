import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppContext } from "../context/AppContext";
import { useMessageNotification } from "../hooks/useMessageNotification";
import { QrScannerDialog } from "../components/common/QrScannerDialog";
import type { ReceivedMessageEntry, SentMessageEntry, UnmatchedMessageEntry } from "../hooks/useMessageNotification";
import type { MessageAttribute, NotificationMessage } from "../lib/types/notification";
import { extractUserCode } from "../lib/playerCode";

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
    case "THREAD_RESOLVED":
      return "解決通知";
    case "REMOTE_DQ_REQUEST":
      return "リモートDQ申請";
    case "REMOTE_DQ_APPROVED":
      return "リモートDQ承認";
    default:
      return attribute;
  }
}

function attributeColor(attribute: MessageAttribute): string {
  switch (attribute) {
    case "CALL":
      return "bg-red-100 text-red-700";
    case "TOURNAMENT_ID_CHECK":
    case "TOURNAMENT_ID_CHECK_RESULT":
      return "bg-amber-100 text-amber-700";
    case "GENERAL":
      return "bg-blue-100 text-blue-700";
    case "THREAD_RESOLVED":
      return "bg-emerald-100 text-emerald-700";
    case "REMOTE_DQ_REQUEST":
      return "bg-rose-100 text-rose-700";
    case "REMOTE_DQ_APPROVED":
      return "bg-green-100 text-green-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function parseTargetTournamentIds(value: string): string[] {
  return value
    .split(/[\n,\s]+/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function MessageListItem({
  entry,
  isSelected,
  isThreadResolved,
  onClick,
}: {
  entry: ReceivedMessageEntry | SentMessageEntry | UnmatchedMessageEntry;
  isSelected: boolean;
  isThreadResolved: boolean;
  onClick: () => void;
}) {
  const message = entry.message;
  const sentTime = message.sentAt ?? message.timestamp;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 border-b transition-colors ${
        isSelected
          ? "bg-blue-50 border-blue-200"
          : "bg-white hover:bg-gray-50 border-gray-200"
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="shrink-0 flex flex-col items-start gap-1">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${attributeColor(message.attribute)}`}>
            {attributeLabel(message.attribute)}
          </span>
          {isThreadResolved && (
            <span className="text-[11px] text-emerald-700 font-medium">✓ 解決</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900 truncate text-sm">{message.title}</p>
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            送信元: {message.eventId}-{message.sourceTournamentId}
          </p>
          {message.matchCardId && (
            <p className="text-[11px] text-gray-500 mt-0.5 truncate">カード: {message.matchCardId}</p>
          )}
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-1 text-right">{fmtTime(sentTime)}</p>
    </button>
  );
}

function ReplyForm({
  onSend,
  onCancel,
  isSending,
}: {
  onSend: (comment: string) => Promise<void>;
  onCancel: () => void;
  isSending: boolean;
}) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    setError("");
    const trimmedComment = comment.trim();
    if (!trimmedComment) {
      setError("返信内容を入力してください");
      return;
    }
    if (trimmedComment.length > MAX_COMMENT_LEN) {
      setError("返信は 300 文字以下で入力してください");
      return;
    }

    try {
      await onSend(trimmedComment);
      setComment("");
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="border-t border-gray-200 p-4 bg-gray-50">
      <h3 className="text-sm font-medium text-gray-700 mb-3">スレッドに返信</h3>
      <div className="space-y-2">
        <textarea
          rows={3}
          placeholder="返信を入力..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT_LEN))}
          disabled={isSending}
        />
        <div className="flex items-end justify-between gap-2">
          <p className="text-xs text-gray-400">{comment.length} / {MAX_COMMENT_LEN}</p>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-60"
            disabled={isSending}
          >
            キャンセル
          </button>
          <button
            onClick={handleSubmit}
            className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
            disabled={isSending}
          >
            {isSending ? "送信中..." : "返信"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageDetailView({
  entry,
  onReply,
  isThreadResolved,
  canResolveThread,
  onResolveThread,
  resolvingThread,
  canRequestRemoteDq,
  canApproveRemoteDq,
  requestingRemoteDq,
  approvingRemoteDq,
  remoteDqExpectedUserCode,
  onRequestRemoteDq,
  onApproveRemoteDq,
}: {
  entry: ReceivedMessageEntry | SentMessageEntry | UnmatchedMessageEntry | null;
  onReply: (parentMessage: NotificationMessage, replyBody: string) => Promise<void>;
  isThreadResolved: boolean;
  canResolveThread: boolean;
  onResolveThread: (message: NotificationMessage) => Promise<void>;
  resolvingThread: boolean;
  canRequestRemoteDq: boolean;
  canApproveRemoteDq: boolean;
  requestingRemoteDq: boolean;
  approvingRemoteDq: boolean;
  remoteDqExpectedUserCode?: string;
  onRequestRemoteDq: (message: NotificationMessage, enteredUserCode: string) => Promise<void>;
  onApproveRemoteDq: (requestMessage: NotificationMessage) => Promise<void>;
}) {
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [replySending, setReplySending] = useState(false);
  const [dqCodeInput, setDqCodeInput] = useState("");
  const [dqError, setDqError] = useState("");
  const [dqVerifiedCode, setDqVerifiedCode] = useState<string | null>(null);
  const [showDqQrScan, setShowDqQrScan] = useState(false);

  if (!entry) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        <p className="text-sm">メッセージを選択してください</p>
      </div>
    );
  }

  const message = entry.message;
  const sentTime = message.sentAt ?? message.timestamp;
  const receivedTime = message.receivedAt;
  const isGeneralMessage =
    message.attribute === "GENERAL" ||
    message.attribute === "REMOTE_DQ_REQUEST" ||
    message.attribute === "REMOTE_DQ_APPROVED";
  const canReply = isGeneralMessage && !isThreadResolved;
  const normalizedExpectedDqCode = extractUserCode(remoteDqExpectedUserCode ?? "");
  const normalizedInputDqCode = extractUserCode(dqCodeInput);
  const canSubmitRemoteDq = !!(
    canRequestRemoteDq &&
    dqVerifiedCode &&
    normalizedExpectedDqCode &&
    dqVerifiedCode === normalizedExpectedDqCode
  );

  useEffect(() => {
    setDqCodeInput("");
    setDqError("");
    setDqVerifiedCode(null);
    setShowDqQrScan(false);
  }, [message.messageId]);

  useEffect(() => {
    if (!normalizedExpectedDqCode || !normalizedInputDqCode || normalizedInputDqCode !== dqVerifiedCode) {
      setDqVerifiedCode(null);
    }
  }, [normalizedExpectedDqCode, normalizedInputDqCode, dqVerifiedCode]);

  const handleReply = async (comment: string) => {
    setReplySending(true);
    try {
      await onReply(message, comment);
      setShowReplyForm(false);
    } finally {
      setReplySending(false);
    }
  };

  const handleRequestRemoteDq = async () => {
    setDqError("");
    if (!canSubmitRemoteDq) {
      setDqError("先にユーザーコードを認証してください");
      return;
    }
    try {
      await onRequestRemoteDq(message, dqVerifiedCode);
      setDqCodeInput("");
      setDqVerifiedCode(null);
    } catch (e) {
      setDqError(String(e));
    }
  };

  const handleVerifyRemoteDqCode = () => {
    setDqError("");
    if (!normalizedInputDqCode) {
      setDqError("ユーザーコードを入力してください");
      setDqVerifiedCode(null);
      return;
    }
    if (!normalizedExpectedDqCode) {
      setDqError("呼び出しメッセージの対象コードが取得できません");
      setDqVerifiedCode(null);
      return;
    }
    if (normalizedInputDqCode !== normalizedExpectedDqCode) {
      setDqError("呼び出しメッセージのユーザーコードと一致しません");
      setDqVerifiedCode(null);
      return;
    }
    setDqVerifiedCode(normalizedInputDqCode);
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {/* ヘッダー */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${attributeColor(message.attribute)}`}>
            {attributeLabel(message.attribute)}
          </span>
          {isThreadResolved && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700">
              解決済み
            </span>
          )}
          <h2 className="text-lg font-bold text-gray-900 flex-1">{message.title}</h2>
          {canResolveThread && !isThreadResolved && (
            <button
              onClick={() => {
                void onResolveThread(message);
              }}
              className="px-2 py-1 text-xs rounded-lg border border-emerald-300 hover:bg-emerald-50 text-emerald-700 disabled:opacity-60"
              disabled={resolvingThread}
            >
              {resolvingThread ? "処理中..." : "スレッドを解決"}
            </button>
          )}
          {canApproveRemoteDq && (
            <button
              onClick={() => {
                void onApproveRemoteDq(message);
              }}
              className="px-2 py-1 text-xs rounded-lg border border-green-300 hover:bg-green-50 text-green-700 disabled:opacity-60"
              disabled={approvingRemoteDq}
            >
              {approvingRemoteDq ? "承認中..." : "DQ申請を承認"}
            </button>
          )}
          {canReply && (
            <button
              onClick={() => setShowReplyForm(!showReplyForm)}
              className="px-2 py-1 text-xs rounded-lg border border-gray-300 hover:bg-gray-50 text-gray-600"
            >
              {showReplyForm ? "キャンセル" : "返信"}
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 mt-3">
          <div>
            <p className="text-gray-400 text-xs">送信元</p>
            <p className="font-mono">
              {message.eventId}-{message.sourceTournamentId} ({message.sourceTournamentName})
            </p>
          </div>
          {message.targetTournamentIds && message.targetTournamentIds.length > 0 && (
            <div>
              <p className="text-gray-400 text-xs">宛先</p>
              <p className="font-mono">{message.targetTournamentIds.join(", ")}</p>
            </div>
          )}
          {message.matchCardId && (
            <div>
              <p className="text-gray-400 text-xs">カードID</p>
              <p className="font-mono">{message.matchCardId}</p>
            </div>
          )}
          <div>
            <p className="text-gray-400 text-xs">送信日時</p>
            <p className="font-mono">{fmtTime(sentTime)}</p>
          </div>
          {receivedTime && (
            <div>
              <p className="text-gray-400 text-xs">受信日時</p>
              <p className="font-mono">{fmtTime(receivedTime)}</p>
            </div>
          )}
        </div>
      </div>

      {/* コンテンツ */}
      <div className={`${showReplyForm ? "" : "flex-1"} overflow-y-auto p-4 space-y-4`}>
        <div>
          <h3 className="text-xs font-medium text-gray-500 uppercase mb-2">メッセージ本文</h3>
          <pre className="text-sm text-gray-700 whitespace-pre-wrap break-words bg-gray-50 rounded-lg p-3 font-sans">
            {message.body}
          </pre>
        </div>

        {message.comment && (
          <div>
            <h3 className="text-xs font-medium text-gray-500 uppercase mb-2">通信欄</h3>
            <p className="text-sm text-gray-700 whitespace-pre-wrap break-words bg-gray-50 rounded-lg p-3">
              {message.comment}
            </p>
          </div>
        )}

        {canRequestRemoteDq && (
          <div>
            <h3 className="text-xs font-medium text-gray-500 uppercase mb-2">リモートDQ申請</h3>
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 space-y-2">
              <p className="text-xs text-rose-800">
                呼び出し対象のユーザーコードを認証すると、DQ申請を送信できます。
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  autoComplete="off"
                  value={dqCodeInput}
                  onChange={(e) => setDqCodeInput(e.target.value)}
                  placeholder="対象プレイヤーのユーザーコード"
                  className="flex-1 border border-rose-300 rounded px-2 py-1 text-xs font-mono"
                  disabled={requestingRemoteDq}
                />
                <button
                  onClick={handleVerifyRemoteDqCode}
                  className="px-3 py-1 text-xs rounded bg-white border border-rose-300 text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                  disabled={requestingRemoteDq}
                >
                  認証
                </button>
                <button
                  onClick={() => setShowDqQrScan(true)}
                  className="px-3 py-1 text-xs rounded bg-white border border-rose-300 text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                  disabled={requestingRemoteDq}
                >
                  カメラ
                </button>
                <button
                  onClick={() => {
                    void handleRequestRemoteDq();
                  }}
                  className="px-3 py-1 text-xs rounded bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60"
                  disabled={requestingRemoteDq || !canSubmitRemoteDq}
                >
                  {requestingRemoteDq ? "送信中..." : "DQ申請"}
                </button>
              </div>
              <p className={`text-xs ${canSubmitRemoteDq ? "text-emerald-700" : "text-rose-700"}`}>
                {canSubmitRemoteDq
                  ? "認証OK: 呼び出しメッセージのユーザーコードと一致しました"
                  : "未認証: 先にコード入力後「認証」を押してください"}
              </p>
              {dqError && <p className="text-xs text-rose-700">{dqError}</p>}
            </div>
          </div>
        )}
      </div>

      <QrScannerDialog
        open={showDqQrScan}
        title="リモートDQ申請コードを読み取り"
        onClose={() => setShowDqQrScan(false)}
        onDetected={(value) => {
          const extracted = extractUserCode(value);
          setDqCodeInput(extracted);
          setShowDqQrScan(false);
          setDqError("");
        }}
      />

      {/* 返信フォーム */}
      {showReplyForm && canReply && (
        <ReplyForm
          onSend={handleReply}
          onCancel={() => setShowReplyForm(false)}
          isSending={replySending}
        />
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
  initialMatchCardId,
  initialMatchSlot,
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
  initialMatchCardId?: string;
  initialMatchSlot?: 1 | 2;
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
    matchCardId?: string;
    matchSlot?: 1 | 2;
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
          matchCardId: initialMatchCardId,
          matchSlot: initialMatchSlot,
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
    matchCardId?: string;
    matchSlot?: 1 | 2;
  } | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [resolvingThread, setResolvingThread] = useState(false);
  const [requestingRemoteDq, setRequestingRemoteDq] = useState(false);
  const [approvingRemoteDq, setApprovingRemoteDq] = useState(false);

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

  const messages = useMemo(() => {
    switch (tab) {
      case "received":
        return receivedMessages;
      case "sent":
        return sentMessages;
      case "unmatched":
        return unmatchedMessages;
    }
  }, [tab, receivedMessages, sentMessages, unmatchedMessages]);

  const allMessages = useMemo(() => {
    return [...receivedMessages, ...sentMessages, ...unmatchedMessages].map((entry) => entry.message);
  }, [receivedMessages, sentMessages, unmatchedMessages]);

  const selectedMessage = useMemo(() => {
    return messages.find((m) => m.message.messageId === selectedMessageId) || null;
  }, [messages, selectedMessageId]);

  const selectedThreadId = selectedMessage?.message.threadId ?? selectedMessage?.message.messageId ?? null;

  const resolvedThreadMap = useMemo(() => {
    const resolved = new Map<string, NotificationMessage>();
    for (const message of allMessages) {
      const threadId = message.threadId ?? message.messageId;
      const isResolvedEvent = message.attribute === "THREAD_RESOLVED" || message.threadResolved === true;
      if (!isResolvedEvent) continue;

      const prev = resolved.get(threadId);
      if (!prev) {
        resolved.set(threadId, message);
        continue;
      }

      const prevTs = new Date(prev.threadResolvedAt ?? prev.sentAt ?? prev.timestamp).getTime();
      const currentTs = new Date(message.threadResolvedAt ?? message.sentAt ?? message.timestamp).getTime();
      if (currentTs >= prevTs) {
        resolved.set(threadId, message);
      }
    }
    return resolved;
  }, [allMessages]);

  const selectedRootMessage = useMemo(() => {
    if (!selectedMessage) return null;
    const current = selectedMessage.message;
    const rootMessageId = current.rootMessageId ?? current.threadId ?? current.messageId;
    return allMessages.find((message) => message.messageId === rootMessageId) ?? null;
  }, [allMessages, selectedMessage]);

  const isSelectedThreadResolved = selectedThreadId ? resolvedThreadMap.has(selectedThreadId) : false;
  const canResolveSelectedThread = !!(
    selectedRootMessage &&
    tournament &&
    selectedRootMessage.sourceTournamentId === tournament.tournament_code
  );
  const canRequestRemoteDq = !!(
    selectedRootMessage &&
    selectedRootMessage.attribute === "CALL" &&
    selectedRootMessage.targetUserCode &&
    selectedRootMessage.matchCardId &&
    selectedRootMessage.matchSlot &&
    !isSelectedThreadResolved
  );
  const remoteDqExpectedUserCode = selectedRootMessage?.targetUserCode;
  const canApproveRemoteDq = !!(
    selectedMessage &&
    selectedMessage.message.attribute === "REMOTE_DQ_REQUEST" &&
    selectedRootMessage &&
    tournament &&
    selectedRootMessage.sourceTournamentId === tournament.tournament_code &&
    !isSelectedThreadResolved
  );

  useEffect(() => {
    if (messages.length > 0 && !selectedMessageId) {
      setSelectedMessageId(messages[0].message.messageId);
    }
  }, [messages, selectedMessageId]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("compose") !== "call") return;

    setComposePreset({
      kind: "CALL",
      selectedPlayerId: params.get("playerId") ?? undefined,
      comment: params.get("comment") ?? undefined,
      matchCardId: params.get("matchCardId") ?? undefined,
      matchSlot: params.get("matchSlot") === "1" ? 1 : params.get("matchSlot") === "2" ? 2 : undefined,
    });
    setShowCompose(true);
    navigate("/notification", { replace: true });
  }, [location.search, navigate]);

  const handleReply = async (parentMessage: NotificationMessage, replyBody: string) => {
    if (!tournament) throw new Error("大会が選択されていません");

    // スレッド情報の取得
    const threadId = parentMessage.threadId ?? parentMessage.messageId;
    const rootMessageId = parentMessage.rootMessageId ?? parentMessage.threadId ?? parentMessage.messageId;
    const rootMessage = allMessages.find((message) => message.messageId === rootMessageId);
    const replyTargetTournamentId = rootMessage?.sourceTournamentId ?? parentMessage.sourceTournamentId;

    await sendMessage({
      attribute: "GENERAL",
      title: `Re: ${parentMessage.title}`,
      body: replyBody,
      comment: undefined,
      targetTournamentIds: [replyTargetTournamentId],
      threadId,
      parentMessageId: parentMessage.messageId,
      rootMessageId,
    });
  };

  const handleResolveThread = async (baseMessage: NotificationMessage) => {
    if (!tournament) throw new Error("大会が選択されていません");

    const threadId = baseMessage.threadId ?? baseMessage.messageId;
    const rootMessageId = baseMessage.rootMessageId ?? baseMessage.threadId ?? baseMessage.messageId;
    const rootMessage = allMessages.find((message) => message.messageId === rootMessageId);

    if (!rootMessage || rootMessage.sourceTournamentId !== tournament.tournament_code) {
      throw new Error("スレッド主のみ解決できます");
    }
    if (resolvedThreadMap.has(threadId)) {
      return;
    }

    const resolvedAt = new Date().toISOString();
    setResolvingThread(true);
    try {
      await sendMessage({
        attribute: "THREAD_RESOLVED",
        title: `[解決] ${rootMessage.title}`,
        body: `${tournament.event_code}-${tournament.tournament_code}:${tournament.name} がスレッドを解決しました。`,
        comment: undefined,
        targetTournamentIds: undefined,
        threadId,
        parentMessageId: baseMessage.messageId,
        rootMessageId,
        threadResolved: true,
        threadResolvedAt: resolvedAt,
        threadResolvedByTournamentId: tournament.tournament_code,
        threadResolvedByTournamentName: tournament.name,
      });
    } finally {
      setResolvingThread(false);
    }
  };

  const handleRequestRemoteDq = async (baseMessage: NotificationMessage, enteredUserCode: string) => {
    if (!tournament) throw new Error("大会が選択されていません");

    const threadId = baseMessage.threadId ?? baseMessage.messageId;
    const rootMessageId = baseMessage.rootMessageId ?? baseMessage.threadId ?? baseMessage.messageId;
    const rootMessage = allMessages.find((message) => message.messageId === rootMessageId);
    if (!rootMessage) throw new Error("スレッド先頭メッセージが見つかりません");
    if (rootMessage.attribute !== "CALL") throw new Error("呼び出しスレッドでのみDQ申請できます");

    const expected = extractUserCode(rootMessage.targetUserCode ?? "");
    const actual = extractUserCode(enteredUserCode);
    if (!expected || !actual || expected !== actual) {
      throw new Error("ユーザーコードが一致しません");
    }
    if (!rootMessage.sourceTournamentId) throw new Error("スレッド主が不明です");
    if (!rootMessage.matchCardId || !rootMessage.matchSlot || !rootMessage.targetPlayerId) {
      throw new Error("呼び出しカード情報が不足しています");
    }

    setRequestingRemoteDq(true);
    try {
      await sendMessage({
        attribute: "REMOTE_DQ_REQUEST",
        title: `DQ申請: ${rootMessage.title}`,
        body: `${tournament.event_code}-${tournament.tournament_code}:${tournament.name} がDQを申請しました。`,
        targetTournamentIds: [rootMessage.sourceTournamentId],
        threadId,
        parentMessageId: baseMessage.messageId,
        rootMessageId,
        matchCardId: rootMessage.matchCardId,
        matchSlot: rootMessage.matchSlot,
        remoteDqTargetPlayerId: rootMessage.targetPlayerId,
        remoteDqTargetPlayerName: rootMessage.targetPlayerName,
        remoteDqTargetUserCode: actual,
        remoteDqRequestedByTournamentId: tournament.tournament_code,
        remoteDqRequestedByTournamentName: tournament.name,
      });
    } finally {
      setRequestingRemoteDq(false);
    }
  };

  const handleApproveRemoteDq = async (requestMessage: NotificationMessage) => {
    if (!tournament) throw new Error("大会が選択されていません");

    const threadId = requestMessage.threadId ?? requestMessage.messageId;
    const rootMessageId = requestMessage.rootMessageId ?? requestMessage.threadId ?? requestMessage.messageId;
    const rootMessage = allMessages.find((message) => message.messageId === rootMessageId);

    if (!rootMessage || rootMessage.sourceTournamentId !== tournament.tournament_code) {
      throw new Error("スレッド主のみ承認できます");
    }
    if (!requestMessage.matchCardId || !requestMessage.remoteDqTargetPlayerId || !requestMessage.remoteDqTargetUserCode) {
      throw new Error("承認に必要な情報が不足しています");
    }
    const requestFromTournamentId = requestMessage.remoteDqRequestedByTournamentId ?? requestMessage.sourceTournamentId;
    if (!requestFromTournamentId) throw new Error("申請元大会が不明です");

    setApprovingRemoteDq(true);
    try {
      await sendMessage({
        attribute: "REMOTE_DQ_APPROVED",
        title: `DQ承認: ${rootMessage.title}`,
        body: `${tournament.event_code}-${tournament.tournament_code}:${tournament.name} がDQ申請を承認しました。`,
        targetTournamentIds: [requestFromTournamentId],
        threadId,
        parentMessageId: requestMessage.messageId,
        rootMessageId,
        matchCardId: requestMessage.matchCardId,
        matchSlot: requestMessage.matchSlot,
        remoteDqTargetPlayerId: requestMessage.remoteDqTargetPlayerId,
        remoteDqTargetPlayerName: requestMessage.remoteDqTargetPlayerName,
        remoteDqTargetUserCode: requestMessage.remoteDqTargetUserCode,
        remoteDqApproved: true,
      });

      const params = new URLSearchParams();
      params.set("matchCardId", requestMessage.matchCardId);
      params.set("dqPlayerId", requestMessage.remoteDqTargetPlayerId);
      params.set("dqUserCode", requestMessage.remoteDqTargetUserCode);
      params.set("fromRemoteDq", "1");
      navigate(`/tournament/bracket?${params.toString()}`);
    } finally {
      setApprovingRemoteDq(false);
    }
  };

  if (!tournament) {
    return (
      <div className="flex items-center justify-center h-full py-20 text-gray-400">
        <p className="text-sm">大会が選択されていません</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
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

      {/* タブ */}
      <div className="flex gap-1 px-6 py-4 bg-gray-100 border-b border-gray-200">
        <button
          onClick={() => {
            setTab("received");
            setSelectedMessageId(null);
          }}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            tab === "received" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          受信したメッセージ
        </button>
        <button
          onClick={() => {
            setTab("sent");
            setSelectedMessageId(null);
          }}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            tab === "sent" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          自分が送信したメッセージ
        </button>
        <button
          onClick={() => {
            setTab("unmatched");
            setSelectedMessageId(null);
          }}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            tab === "unmatched" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          未受理メッセージ
        </button>
      </div>

      {/* メインコンテンツ */}
      <div className="flex-1 flex overflow-hidden">
        {/* メッセージリスト */}
        <div className="w-80 border-r border-gray-200 flex flex-col bg-white">
          {messages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <p className="text-sm">メッセージがありません</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {messages.map((entry) => (
                <MessageListItem
                  key={entry.message.messageId}
                  entry={entry}
                  isSelected={selectedMessage?.message.messageId === entry.message.messageId}
                  isThreadResolved={resolvedThreadMap.has(entry.message.threadId ?? entry.message.messageId)}
                  onClick={() => setSelectedMessageId(entry.message.messageId)}
                />
              ))}
            </div>
          )}
        </div>

        {/* メッセージ詳細 */}
        <div className="flex-1 overflow-hidden">
          <MessageDetailView
            entry={selectedMessage}
            onReply={handleReply}
            isThreadResolved={isSelectedThreadResolved}
            canResolveThread={canResolveSelectedThread}
            onResolveThread={handleResolveThread}
            resolvingThread={resolvingThread}
            canRequestRemoteDq={canRequestRemoteDq}
            canApproveRemoteDq={canApproveRemoteDq}
            requestingRemoteDq={requestingRemoteDq}
            approvingRemoteDq={approvingRemoteDq}
            remoteDqExpectedUserCode={remoteDqExpectedUserCode}
            onRequestRemoteDq={handleRequestRemoteDq}
            onApproveRemoteDq={handleApproveRemoteDq}
          />
        </div>
      </div>

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
          initialMatchCardId={composePreset?.matchCardId}
          initialMatchSlot={composePreset?.matchSlot}
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
