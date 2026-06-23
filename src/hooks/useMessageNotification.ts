import {
  createElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type {
  MessagePayload,
  MessageAttribute,
  NotificationMessage,
} from "../lib/types/notification";
import { useAppContext } from "../context/AppContext";

// ─────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────

/** 複合メッセージID を生成する。形式: {eventId}_{tournamentId}_{timestamp}_{random6} */
function generateCompositeMessageId(eventId: string, tournamentId: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${eventId}_${tournamentId}_${ts}_${rand}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ─────────────────────────────────────────
// State types (exported for use in UI)
// ─────────────────────────────────────────

export interface SentMessageEntry {
  message: NotificationMessage;
}

export interface ReceivedMessageEntry {
  message: NotificationMessage;
}

interface NotificationState {
  receivedMessages: ReceivedMessageEntry[];
  sentMessages: SentMessageEntry[];
}

type NotificationAction =
  | { type: "RECEIVE_MESSAGE"; message: NotificationMessage }
  | { type: "ADD_SENT_MESSAGE"; message: NotificationMessage };

function reducer(state: NotificationState, action: NotificationAction): NotificationState {
  switch (action.type) {
    case "RECEIVE_MESSAGE":
      return {
        ...state,
        receivedMessages: [{ message: action.message }, ...state.receivedMessages],
      };

    case "ADD_SENT_MESSAGE":
      return {
        ...state,
        sentMessages: [{ message: action.message }, ...state.sentMessages],
      };

    default:
      return state;
  }
}

const initialState: NotificationState = {
  receivedMessages: [],
  sentMessages: [],
};

type MessageNotificationContextValue = {
  receivedMessages: ReceivedMessageEntry[];
  sentMessages: SentMessageEntry[];
  sendMessage: (input: {
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
};

const MessageNotificationContext = createContext<MessageNotificationContextValue | null>(null);

// ─────────────────────────────────────────
// Hook
// ─────────────────────────────────────────

export function MessageNotificationProvider({ children }: { children: ReactNode }) {
  const { tournament } = useAppContext();
  const [state, dispatch] = useReducer(reducer, initialState);

  /**
   * 処理済み messageId の Set。
   * - 自分が送信したメッセージのバウンスバック除外
   * - 再送による重複パケットの排除
   * State ではなく Ref にすることで再レンダリングを回避する。
   */
  const seenMessageIds = useRef<Set<string>>(new Set());

  const broadcast = useCallback(async (payload: MessagePayload) => {
    await invoke<void>("send_udp_broadcast", { payload: JSON.stringify(payload) });
  }, []);

  const shouldAcceptByDestination = useCallback(
    (message: NotificationMessage): boolean => {
      const targets = message.targetTournamentIds ?? [];
      if (targets.length === 0) return true;
      if (!tournament) return false;
      return targets.includes(tournament.tournament_code);
    },
    [tournament]
  );

  const maybeSendTournamentIdCheckResult = useCallback(
    async (requestMessage: NotificationMessage): Promise<void> => {
      if (!tournament) return;
      if (requestMessage.attribute !== "TOURNAMENT_ID_CHECK") return;
      if (!requestMessage.requestedTournamentId) return;

      // 自分自身が送った確認要求には反応しない
      if (requestMessage.sourceTournamentId === tournament.tournament_code) return;

      // 進行中の大会のみ応答対象
      if (tournament.status !== "in_progress") return;

      // 確認要求された大会IDと自大会IDが一致する場合のみ応答
      if (requestMessage.requestedTournamentId !== tournament.tournament_code) return;

      const resultMessage: NotificationMessage = {
        messageId: generateCompositeMessageId(tournament.event_code, tournament.tournament_code),
        eventId: tournament.event_code,
        sourceTournamentId: tournament.tournament_code,
        sourceTournamentName: tournament.name,
        attribute: "TOURNAMENT_ID_CHECK_RESULT",
        title: `大会ID確認応答:${tournament.name}`,
        body: `${tournament.event_code}-${tournament.tournament_code}:${tournament.name}\n大会IDが重複しています。ID調整をお願いします。`,
        targetTournamentIds: [requestMessage.sourceTournamentId],
        requestedTournamentId: requestMessage.requestedTournamentId,
        isDuplicateTournamentId: true,
        timestamp: nowIso(),
      };

      seenMessageIds.current.add(resultMessage.messageId);
      await broadcast({ type: "MESSAGE", data: resultMessage });
    },
    [tournament, broadcast]
  );

  // ── UDP 受信リスナー ────────────────────────
  useEffect(() => {
    if (!tournament) return;

    let unlisten: (() => void) | undefined;

    (async () => {
      unlisten = await listen<string>("udp-received", (event) => {
        let payload: MessagePayload;
        try {
          payload = JSON.parse(event.payload) as MessagePayload;
        } catch {
          // 不正な JSON は無視
          return;
        }

        if (payload.type !== "MESSAGE") return;

        const message = payload.data;
        const { messageId } = message;

        // ① eventId フィルタリング: 自分のイベントでなければ即破棄
        if (message.eventId !== tournament.event_code) return;

        // ② 宛先大会IDフィルタリング
        if (!shouldAcceptByDestination(message)) return;

        // ③ 重複排除
        if (seenMessageIds.current.has(messageId)) return;
        seenMessageIds.current.add(messageId);

        dispatch({ type: "RECEIVE_MESSAGE", message });
        void maybeSendTournamentIdCheckResult(message);
      });
    })();

    return () => {
      unlisten?.();
    };
  }, [tournament, shouldAcceptByDestination, maybeSendTournamentIdCheckResult]);

  // ── メッセージ送信 ──────────────────
  const sendMessage = useCallback(
    async (input: {
      attribute: MessageAttribute;
      title: string;
      body: string;
      comment?: string;
      targetTournamentIds?: string[];
      targetPlayerId?: string;
      targetPlayerName?: string;
      targetUserCode?: string;
      requestedTournamentId?: string;
    }): Promise<void> => {
      if (!tournament) throw new Error("大会が選択されていません");

      const message: NotificationMessage = {
        messageId: generateCompositeMessageId(tournament.event_code, tournament.tournament_code),
        eventId: tournament.event_code,
        sourceTournamentId: tournament.tournament_code,
        sourceTournamentName: tournament.name,
        attribute: input.attribute,
        title: input.title,
        body: input.body,
        comment: input.comment,
        targetTournamentIds: input.targetTournamentIds,
        targetPlayerId: input.targetPlayerId,
        targetPlayerName: input.targetPlayerName,
        targetUserCode: input.targetUserCode,
        requestedTournamentId: input.requestedTournamentId,
        timestamp: nowIso(),
      };

      // バウンスバック対策: 送信前に seenMessageIds へ登録しておく
      seenMessageIds.current.add(message.messageId);
      dispatch({ type: "ADD_SENT_MESSAGE", message });
      await broadcast({ type: "MESSAGE", data: message });
    },
    [tournament, broadcast]
  );

  return createElement(
    MessageNotificationContext.Provider,
    {
      value: {
        receivedMessages: state.receivedMessages,
        sentMessages: state.sentMessages,
        sendMessage,
      },
    },
    children
  );
}

export function useMessageNotification() {
  const context = useContext(MessageNotificationContext);
  if (!context) {
    throw new Error("useMessageNotification must be used within MessageNotificationProvider");
  }

  return {
    receivedMessages: context.receivedMessages,
    sentMessages: context.sentMessages,
    sendMessage: context.sendMessage,
  };
}