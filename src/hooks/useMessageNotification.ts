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
import {
  getTournamentMessages,
  getTournamentsByEventCode,
  getUnmatchedMessages,
  hasTournamentMessageById,
  insertUnmatchedMessage,
  insertTournamentMessage,
} from "../lib/database";

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

export interface UnmatchedMessageEntry {
  message: NotificationMessage;
}

interface NotificationState {
  receivedMessages: ReceivedMessageEntry[];
  sentMessages: SentMessageEntry[];
  unmatchedMessages: UnmatchedMessageEntry[];
}

type NotificationAction =
  | {
      type: "HYDRATE_MESSAGES";
      receivedMessages: ReceivedMessageEntry[];
      sentMessages: SentMessageEntry[];
      unmatchedMessages: UnmatchedMessageEntry[];
    }
  | { type: "RECEIVE_MESSAGE"; message: NotificationMessage }
  | { type: "ADD_SENT_MESSAGE"; message: NotificationMessage }
  | { type: "ADD_UNMATCHED_MESSAGE"; message: NotificationMessage };

function reducer(state: NotificationState, action: NotificationAction): NotificationState {
  switch (action.type) {
    case "RECEIVE_MESSAGE":
      return {
        ...state,
        receivedMessages: [{ message: action.message }, ...state.receivedMessages],
      };

    case "HYDRATE_MESSAGES":
      return {
        receivedMessages: action.receivedMessages,
        sentMessages: action.sentMessages,
        unmatchedMessages: action.unmatchedMessages,
      };

    case "ADD_SENT_MESSAGE":
      return {
        ...state,
        sentMessages: [{ message: action.message }, ...state.sentMessages],
      };

    case "ADD_UNMATCHED_MESSAGE":
      return {
        ...state,
        unmatchedMessages: [{ message: action.message }, ...state.unmatchedMessages],
      };

    default:
      return state;
  }
}

const initialState: NotificationState = {
  receivedMessages: [],
  sentMessages: [],
  unmatchedMessages: [],
};

type MessageNotificationContextValue = {
  receivedMessages: ReceivedMessageEntry[];
  sentMessages: SentMessageEntry[];
  unmatchedMessages: UnmatchedMessageEntry[];
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
  const { tournament, tournamentList } = useAppContext();
  const [state, dispatch] = useReducer(reducer, initialState);

  /**
   * 処理済み messageId の Set。
   * - 自分が送信したメッセージのバウンスバック除外
   * - 再送による重複パケットの排除
   * State ではなく Ref にすることで再レンダリングを回避する。
   */
  const seenMessageIds = useRef<Set<string>>(new Set());

  const persistMessage = useCallback(async (message: NotificationMessage, direction: "sent" | "received") => {
    if (!tournament) return;
    await insertTournamentMessage({
      id: message.messageId,
      tournament_id: tournament.id,
      event_code: message.eventId,
      source_tournament_id: message.sourceTournamentId,
      source_tournament_db_id: message.sourceTournamentDbId ?? null,
      source_tournament_name: message.sourceTournamentName,
      attribute: message.attribute,
      title: message.title,
      body: message.body,
      comment: message.comment ?? null,
      target_tournament_ids: message.targetTournamentIds ?? [],
      target_player_id: message.targetPlayerId ?? null,
      target_player_name: message.targetPlayerName ?? null,
      target_user_code: message.targetUserCode ?? null,
      requested_tournament_id: message.requestedTournamentId ?? null,
      is_duplicate_tournament_id: message.isDuplicateTournamentId ?? false,
      thread_id: message.threadId ?? message.messageId,
      parent_message_id: message.parentMessageId ?? null,
      root_message_id: message.rootMessageId ?? message.threadId ?? message.messageId,
      direction,
      timestamp: message.sentAt ?? message.timestamp,
      created_at: nowIso(),
    });
  }, [tournament]);

  const persistMessageForTournament = useCallback(
    async (targetTournamentId: string, message: NotificationMessage, direction: "sent" | "received") => {
      await insertTournamentMessage({
        id: message.messageId,
        tournament_id: targetTournamentId,
        event_code: message.eventId,
        source_tournament_id: message.sourceTournamentId,
        source_tournament_db_id: message.sourceTournamentDbId ?? null,
        source_tournament_name: message.sourceTournamentName,
        attribute: message.attribute,
        title: message.title,
        body: message.body,
        comment: message.comment ?? null,
        target_tournament_ids: message.targetTournamentIds ?? [],
        target_player_id: message.targetPlayerId ?? null,
        target_player_name: message.targetPlayerName ?? null,
        target_user_code: message.targetUserCode ?? null,
        requested_tournament_id: message.requestedTournamentId ?? null,
        is_duplicate_tournament_id: message.isDuplicateTournamentId ?? false,
        thread_id: message.threadId ?? message.messageId,
        parent_message_id: message.parentMessageId ?? null,
        root_message_id: message.rootMessageId ?? message.threadId ?? message.messageId,
        direction,
        timestamp: message.sentAt ?? message.timestamp,
        created_at: nowIso(),
      });
    },
    []
  );

  const persistUnmatchedMessage = useCallback(async (message: NotificationMessage) => {
    await insertUnmatchedMessage({
      id: message.messageId,
      event_code: message.eventId,
      source_tournament_id: message.sourceTournamentId,
      source_tournament_db_id: message.sourceTournamentDbId ?? null,
      source_tournament_name: message.sourceTournamentName,
      attribute: message.attribute,
      title: message.title,
      body: message.body,
      comment: message.comment ?? null,
      target_tournament_ids: message.targetTournamentIds ?? [],
      target_player_id: message.targetPlayerId ?? null,
      target_player_name: message.targetPlayerName ?? null,
      target_user_code: message.targetUserCode ?? null,
      requested_tournament_id: message.requestedTournamentId ?? null,
      is_duplicate_tournament_id: message.isDuplicateTournamentId ?? false,
      thread_id: message.threadId ?? message.messageId,
      parent_message_id: message.parentMessageId ?? null,
      root_message_id: message.rootMessageId ?? message.threadId ?? message.messageId,
      timestamp: message.sentAt ?? message.timestamp,
      created_at: nowIso(),
    });
  }, []);

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
        sourceTournamentDbId: tournament.id,
        sourceTournamentId: tournament.tournament_code,
        sourceTournamentName: tournament.name,
        attribute: "TOURNAMENT_ID_CHECK_RESULT",
        title: `大会ID確認応答:${tournament.name}`,
        body: `${tournament.event_code}-${tournament.tournament_code}:${tournament.name}\n大会IDが重複しています。ID調整をお願いします。`,
        targetTournamentIds: [requestMessage.sourceTournamentId],
        requestedTournamentId: requestMessage.requestedTournamentId,
        isDuplicateTournamentId: true,
        threadId: requestMessage.threadId ?? requestMessage.messageId,
        parentMessageId: requestMessage.messageId,
        rootMessageId: requestMessage.rootMessageId ?? requestMessage.threadId ?? requestMessage.messageId,
        sentAt: nowIso(),
        timestamp: nowIso(),
      };

      seenMessageIds.current.add(resultMessage.messageId);
      await persistMessage(resultMessage, "sent");
      await broadcast({ type: "MESSAGE", data: resultMessage });
    },
    [tournament, broadcast, persistMessage]
  );

  // ── UDP 受信リスナー ────────────────────────
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const loadPersistedMessages = async () => {
      if (!tournament) {
        dispatch({
          type: "HYDRATE_MESSAGES",
          receivedMessages: [],
          sentMessages: [],
          unmatchedMessages: [],
        });
        return;
      }

      const records = await getTournamentMessages(tournament.id);
      const unmatchedRecords = await getUnmatchedMessages();
      const received = records
        .filter((record) => record.direction === "received")
        .map((record) => ({
          message: {
            messageId: record.id,
            eventId: record.event_code,
            sourceTournamentDbId: record.source_tournament_db_id ?? undefined,
            sourceTournamentId: record.source_tournament_id,
            sourceTournamentName: record.source_tournament_name,
            attribute: record.attribute as MessageAttribute,
            title: record.title,
            body: record.body,
            comment: record.comment ?? undefined,
            targetTournamentIds: record.target_tournament_ids,
            targetPlayerId: record.target_player_id ?? undefined,
            targetPlayerName: record.target_player_name ?? undefined,
            targetUserCode: record.target_user_code ?? undefined,
            requestedTournamentId: record.requested_tournament_id ?? undefined,
            isDuplicateTournamentId: record.is_duplicate_tournament_id,
            threadId: record.thread_id ?? undefined,
            parentMessageId: record.parent_message_id ?? undefined,
            rootMessageId: record.root_message_id ?? undefined,
              sentAt: record.timestamp,
              receivedAt: record.created_at,
            timestamp: record.timestamp,
          },
        }));

      const sent = records
        .filter((record) => record.direction === "sent")
        .map((record) => ({
          message: {
            messageId: record.id,
            eventId: record.event_code,
            sourceTournamentDbId: record.source_tournament_db_id ?? undefined,
            sourceTournamentId: record.source_tournament_id,
            sourceTournamentName: record.source_tournament_name,
            attribute: record.attribute as MessageAttribute,
            title: record.title,
            body: record.body,
            comment: record.comment ?? undefined,
            targetTournamentIds: record.target_tournament_ids,
            targetPlayerId: record.target_player_id ?? undefined,
            targetPlayerName: record.target_player_name ?? undefined,
            targetUserCode: record.target_user_code ?? undefined,
            requestedTournamentId: record.requested_tournament_id ?? undefined,
            isDuplicateTournamentId: record.is_duplicate_tournament_id,
            threadId: record.thread_id ?? undefined,
            parentMessageId: record.parent_message_id ?? undefined,
            rootMessageId: record.root_message_id ?? undefined,
            sentAt: record.timestamp,
            receivedAt: undefined,
            timestamp: record.timestamp,
          },
        }));

      const unmatched = unmatchedRecords.map((record) => ({
        message: {
          messageId: record.id,
          eventId: record.event_code,
          sourceTournamentDbId: record.source_tournament_db_id ?? undefined,
          sourceTournamentId: record.source_tournament_id,
          sourceTournamentName: record.source_tournament_name,
          attribute: record.attribute as MessageAttribute,
          title: record.title,
          body: record.body,
          comment: record.comment ?? undefined,
          targetTournamentIds: record.target_tournament_ids,
          targetPlayerId: record.target_player_id ?? undefined,
          targetPlayerName: record.target_player_name ?? undefined,
          targetUserCode: record.target_user_code ?? undefined,
          requestedTournamentId: record.requested_tournament_id ?? undefined,
          isDuplicateTournamentId: record.is_duplicate_tournament_id,
          threadId: record.thread_id ?? undefined,
          parentMessageId: record.parent_message_id ?? undefined,
          rootMessageId: record.root_message_id ?? undefined,
          sentAt: record.timestamp,
          receivedAt: record.created_at,
          timestamp: record.timestamp,
        },
      }));

      seenMessageIds.current = new Set(records.map((record) => record.id));
      dispatch({
        type: "HYDRATE_MESSAGES",
        receivedMessages: received,
        sentMessages: sent,
        unmatchedMessages: unmatched,
      });
    };

    void loadPersistedMessages();

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
        // ② 重複排除
        if (seenMessageIds.current.has(messageId)) return;

        void (async () => {
          if (await hasTournamentMessageById(messageId)) {
            seenMessageIds.current.add(messageId);
            return;
          }

          const sameEventTournaments = await getTournamentsByEventCode(message.eventId);
          const targets = message.targetTournamentIds ?? [];
          const acceptedTournaments = sameEventTournaments.filter((t) => {
            if (targets.length === 0) return true;
            return targets.includes(t.tournament_code);
          });

          message.receivedAt = nowIso();
          message.sentAt = message.sentAt ?? message.timestamp;

          if (acceptedTournaments.length === 0) {
            await persistUnmatchedMessage(message);
            if (tournament && message.eventId === tournament.event_code) {
              dispatch({ type: "ADD_UNMATCHED_MESSAGE", message });
            }
            seenMessageIds.current.add(messageId);
            return;
          }

          for (const accepted of acceptedTournaments) {
            await persistMessageForTournament(accepted.id, message, "received");
          }

          if (tournament && acceptedTournaments.some((t) => t.id === tournament.id)) {
            dispatch({ type: "RECEIVE_MESSAGE", message });
            void maybeSendTournamentIdCheckResult(message);
          }

          seenMessageIds.current.add(messageId);
        })();

        // NOTE: async block handles dispatch/persist and seen state.
        return;

        // ③ 旧フロー（未使用）
        seenMessageIds.current.add(messageId);
      });
    })();

    return () => {
      unlisten?.();
    };
  }, [
    tournament,
    tournamentList,
    shouldAcceptByDestination,
    maybeSendTournamentIdCheckResult,
    persistMessage,
    persistMessageForTournament,
    persistUnmatchedMessage,
  ]);

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
        sourceTournamentDbId: tournament.id,
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
        threadId: undefined,
        parentMessageId: undefined,
        rootMessageId: undefined,
        sentAt: nowIso(),
        timestamp: nowIso(),
      };

      message.threadId = message.messageId;
      message.rootMessageId = message.messageId;

      // バウンスバック対策: 送信前に seenMessageIds へ登録しておく
      seenMessageIds.current.add(message.messageId);
      dispatch({ type: "ADD_SENT_MESSAGE", message });
      await persistMessage(message, "sent");
      await broadcast({ type: "MESSAGE", data: message });
    },
    [tournament, broadcast, persistMessage]
  );

  return createElement(
    MessageNotificationContext.Provider,
    {
      value: {
        receivedMessages: state.receivedMessages,
        sentMessages: state.sentMessages,
        unmatchedMessages: state.unmatchedMessages,
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
    unmatchedMessages: context.unmatchedMessages,
    sendMessage: context.sendMessage,
  };
}