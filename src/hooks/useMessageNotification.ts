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
  insertUnmatchedMessage,
  insertTournamentMessage,
} from "../lib/database";

const MESSAGE_LAST_SEEN_KEY = "message-last-seen-by-tournament";
const MESSAGE_READ_IDS_KEY = "message-read-ids-by-tournament";

type LastSeenByTournament = Record<string, string>;
type ReadMessageIdsByTournament = Record<string, string[]>;

function loadLastSeenByTournament(): LastSeenByTournament {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MESSAGE_LAST_SEEN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const result: LastSeenByTournament = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function saveLastSeenByTournament(lastSeenByTournament: LastSeenByTournament): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MESSAGE_LAST_SEEN_KEY, JSON.stringify(lastSeenByTournament));
  } catch {
    // localStorage が使えない環境でも動作は継続
  }
}

function loadReadMessageIdsByTournament(): ReadMessageIdsByTournament {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MESSAGE_READ_IDS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const result: ReadMessageIdsByTournament = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        result[key] = value.filter((item): item is string => typeof item === "string");
      }
    }
    return result;
  } catch {
    return {};
  }
}

function saveReadMessageIdsByTournament(readIdsByTournament: ReadMessageIdsByTournament): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MESSAGE_READ_IDS_KEY, JSON.stringify(readIdsByTournament));
  } catch {
    // localStorage が使えない環境でも動作は継続
  }
}

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

function toMatchSlot(slot: number | null | undefined): 1 | 2 | undefined {
  if (slot === 1 || slot === 2) return slot;
  return undefined;
}

function normalizeTargetTournamentIds(targets: string[] | undefined): string[] {
  if (!targets || targets.length === 0) return [];
  return targets
    .map((target) => target.trim())
    .filter((target) => target.length > 0);
}

function matchesTournamentDestination(
  tournamentRef: { id: string; tournament_code: string },
  targets: string[]
): boolean {
  if (targets.length === 0) return true;
  return targets.includes(tournamentRef.tournament_code) || targets.includes(tournamentRef.id);
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
  unreadReceivedMessageIds: string[];
  unreadReceivedCount: number;
}

type NotificationAction =
  | {
      type: "HYDRATE_MESSAGES";
      receivedMessages: ReceivedMessageEntry[];
      sentMessages: SentMessageEntry[];
      unmatchedMessages: UnmatchedMessageEntry[];
      unreadReceivedMessageIds: string[];
    }
  | { type: "RECEIVE_MESSAGE"; message: NotificationMessage; markAsUnread: boolean }
  | { type: "ADD_SENT_MESSAGE"; message: NotificationMessage }
  | { type: "ADD_UNMATCHED_MESSAGE"; message: NotificationMessage }
  | { type: "MARK_RECEIVED_READ"; messageId: string }
  | { type: "MARK_ALL_RECEIVED_READ" };

function reducer(state: NotificationState, action: NotificationAction): NotificationState {
  switch (action.type) {
    case "RECEIVE_MESSAGE":
      {
      const alreadyUnread = state.unreadReceivedMessageIds.includes(action.message.messageId);
      const nextUnreadIds =
        action.markAsUnread && !alreadyUnread
          ? [action.message.messageId, ...state.unreadReceivedMessageIds]
          : state.unreadReceivedMessageIds;
      return {
        ...state,
        receivedMessages: [{ message: action.message }, ...state.receivedMessages],
        unreadReceivedMessageIds: nextUnreadIds,
        unreadReceivedCount: nextUnreadIds.length,
      };
      }

    case "HYDRATE_MESSAGES":
      return {
        receivedMessages: action.receivedMessages,
        sentMessages: action.sentMessages,
        unmatchedMessages: action.unmatchedMessages,
        unreadReceivedMessageIds: action.unreadReceivedMessageIds,
        unreadReceivedCount: action.unreadReceivedMessageIds.length,
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

    case "MARK_RECEIVED_READ":
      {
      if (!state.unreadReceivedMessageIds.includes(action.messageId)) return state;
      const nextUnreadIds = state.unreadReceivedMessageIds.filter((id) => id !== action.messageId);
      return {
        ...state,
        unreadReceivedMessageIds: nextUnreadIds,
        unreadReceivedCount: nextUnreadIds.length,
      };
      }

    case "MARK_ALL_RECEIVED_READ":
      if (state.unreadReceivedMessageIds.length === 0) return state;
      return {
        ...state,
        unreadReceivedMessageIds: [],
        unreadReceivedCount: 0,
      };

    default:
      return state;
  }
}

const initialState: NotificationState = {
  receivedMessages: [],
  sentMessages: [],
  unmatchedMessages: [],
  unreadReceivedMessageIds: [],
  unreadReceivedCount: 0,
};

type MessageNotificationContextValue = {
  receivedMessages: ReceivedMessageEntry[];
  sentMessages: SentMessageEntry[];
  unmatchedMessages: UnmatchedMessageEntry[];
  unreadReceivedCount: number;
  isReceivedMessageUnread: (messageId: string) => boolean;
  markReceivedMessageRead: (messageId: string) => void;
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
    matchCardId?: string;
    matchSlot?: 1 | 2;
    remoteDqTargetPlayerId?: string;
    remoteDqTargetPlayerName?: string;
    remoteDqTargetUserCode?: string;
    remoteDqRequestedByTournamentId?: string;
    remoteDqRequestedByTournamentName?: string;
    remoteDqApproved?: boolean;
    threadId?: string;
    parentMessageId?: string;
    rootMessageId?: string;
    threadResolved?: boolean;
    threadResolvedAt?: string;
    threadResolvedByTournamentId?: string;
    threadResolvedByTournamentName?: string;
  }) => Promise<void>;
};

const MessageNotificationContext = createContext<MessageNotificationContextValue | null>(null);

// ─────────────────────────────────────────
// Hook
// ─────────────────────────────────────────

export function MessageNotificationProvider({ children }: { children: ReactNode }) {
  const { tournament, tournamentList } = useAppContext();
  const [state, dispatch] = useReducer(reducer, initialState);
  const previousTournamentIdRef = useRef<string | null>(null);
  const lastSeenByTournamentRef = useRef<LastSeenByTournament>(loadLastSeenByTournament());
  const readMessageIdsByTournamentRef = useRef<ReadMessageIdsByTournament>(loadReadMessageIdsByTournament());

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
      match_card_id: message.matchCardId ?? null,
      match_slot: message.matchSlot ?? null,
      remote_dq_target_player_id: message.remoteDqTargetPlayerId ?? null,
      remote_dq_target_player_name: message.remoteDqTargetPlayerName ?? null,
      remote_dq_target_user_code: message.remoteDqTargetUserCode ?? null,
      remote_dq_requested_by_tournament_id: message.remoteDqRequestedByTournamentId ?? null,
      remote_dq_requested_by_tournament_name: message.remoteDqRequestedByTournamentName ?? null,
      remote_dq_approved: message.remoteDqApproved ?? false,
      is_duplicate_tournament_id: message.isDuplicateTournamentId ?? false,
      thread_id: message.threadId ?? message.messageId,
      parent_message_id: message.parentMessageId ?? null,
      root_message_id: message.rootMessageId ?? message.threadId ?? message.messageId,
      thread_resolved: message.threadResolved ?? false,
      thread_resolved_at: message.threadResolvedAt ?? null,
      thread_resolved_by_tournament_id: message.threadResolvedByTournamentId ?? null,
      thread_resolved_by_tournament_name: message.threadResolvedByTournamentName ?? null,
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
        match_card_id: message.matchCardId ?? null,
        match_slot: message.matchSlot ?? null,
        remote_dq_target_player_id: message.remoteDqTargetPlayerId ?? null,
        remote_dq_target_player_name: message.remoteDqTargetPlayerName ?? null,
        remote_dq_target_user_code: message.remoteDqTargetUserCode ?? null,
        remote_dq_requested_by_tournament_id: message.remoteDqRequestedByTournamentId ?? null,
        remote_dq_requested_by_tournament_name: message.remoteDqRequestedByTournamentName ?? null,
        remote_dq_approved: message.remoteDqApproved ?? false,
        is_duplicate_tournament_id: message.isDuplicateTournamentId ?? false,
        thread_id: message.threadId ?? message.messageId,
        parent_message_id: message.parentMessageId ?? null,
        root_message_id: message.rootMessageId ?? message.threadId ?? message.messageId,
        thread_resolved: message.threadResolved ?? false,
        thread_resolved_at: message.threadResolvedAt ?? null,
        thread_resolved_by_tournament_id: message.threadResolvedByTournamentId ?? null,
        thread_resolved_by_tournament_name: message.threadResolvedByTournamentName ?? null,
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
      match_card_id: message.matchCardId ?? null,
      match_slot: message.matchSlot ?? null,
      remote_dq_target_player_id: message.remoteDqTargetPlayerId ?? null,
      remote_dq_target_player_name: message.remoteDqTargetPlayerName ?? null,
      remote_dq_target_user_code: message.remoteDqTargetUserCode ?? null,
      remote_dq_requested_by_tournament_id: message.remoteDqRequestedByTournamentId ?? null,
      remote_dq_requested_by_tournament_name: message.remoteDqRequestedByTournamentName ?? null,
      remote_dq_approved: message.remoteDqApproved ?? false,
      is_duplicate_tournament_id: message.isDuplicateTournamentId ?? false,
      thread_id: message.threadId ?? message.messageId,
      parent_message_id: message.parentMessageId ?? null,
      root_message_id: message.rootMessageId ?? message.threadId ?? message.messageId,
      thread_resolved: message.threadResolved ?? false,
      thread_resolved_at: message.threadResolvedAt ?? null,
      thread_resolved_by_tournament_id: message.threadResolvedByTournamentId ?? null,
      thread_resolved_by_tournament_name: message.threadResolvedByTournamentName ?? null,
      timestamp: message.sentAt ?? message.timestamp,
      created_at: nowIso(),
    });
  }, []);

  const broadcast = useCallback(async (payload: MessagePayload) => {
    await invoke<void>("send_udp_broadcast", { payload: JSON.stringify(payload) });
  }, []);

  const notifyIncomingMessage = useCallback((message: NotificationMessage) => {
    if (!("Notification" in window)) return;

    const title = `新着メッセージ: ${message.title}`;
    const body = `${message.sourceTournamentName} (${message.eventId}-${message.sourceTournamentId})`;

    const showNotification = () => {
      try {
        new Notification(title, {
          body,
          tag: message.messageId,
        });
      } catch {
        // 通知APIが失敗してもアプリ動作は継続
      }
    };

    if (Notification.permission === "granted") {
      showNotification();
      return;
    }

    if (Notification.permission === "default") {
      void Notification.requestPermission().then((permission) => {
        if (permission === "granted") {
          showNotification();
        }
      });
    }
  }, []);

  const updateTournamentLastSeen = useCallback((tournamentId: string, seenAtIso?: string) => {
    const nextSeenAt = seenAtIso ?? nowIso();
    const nextMap: LastSeenByTournament = {
      ...lastSeenByTournamentRef.current,
      [tournamentId]: nextSeenAt,
    };
    lastSeenByTournamentRef.current = nextMap;
    saveLastSeenByTournament(nextMap);
  }, []);

  const markReceivedMessageRead = useCallback((messageId: string) => {
    if (!tournament?.id || !messageId) return;
    const current = readMessageIdsByTournamentRef.current[tournament.id] ?? [];
    if (current.includes(messageId)) return;
    const next = [...current, messageId];
    const nextMap: ReadMessageIdsByTournament = {
      ...readMessageIdsByTournamentRef.current,
      [tournament.id]: next,
    };
    readMessageIdsByTournamentRef.current = nextMap;
    saveReadMessageIdsByTournament(nextMap);
    dispatch({ type: "MARK_RECEIVED_READ", messageId });
  }, [tournament?.id]);

  const shouldAcceptByDestination = useCallback(
    (message: NotificationMessage): boolean => {
      const targets = normalizeTargetTournamentIds(message.targetTournamentIds);
      if (targets.length === 0) return true;
      if (!tournament) return false;
      return matchesTournamentDestination(tournament, targets);
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
          unreadReceivedMessageIds: [],
        });
        return;
      }

      const records = await getTournamentMessages(tournament.id);
      const unmatchedRecords = await getUnmatchedMessages();
      const readMessageIds = new Set(readMessageIdsByTournamentRef.current[tournament.id] ?? []);
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
            matchCardId: record.match_card_id ?? undefined,
            matchSlot: toMatchSlot(record.match_slot),
            remoteDqTargetPlayerId: record.remote_dq_target_player_id ?? undefined,
            remoteDqTargetPlayerName: record.remote_dq_target_player_name ?? undefined,
            remoteDqTargetUserCode: record.remote_dq_target_user_code ?? undefined,
            remoteDqRequestedByTournamentId: record.remote_dq_requested_by_tournament_id ?? undefined,
            remoteDqRequestedByTournamentName: record.remote_dq_requested_by_tournament_name ?? undefined,
            remoteDqApproved: record.remote_dq_approved,
            isDuplicateTournamentId: record.is_duplicate_tournament_id,
            threadId: record.thread_id ?? undefined,
            parentMessageId: record.parent_message_id ?? undefined,
            rootMessageId: record.root_message_id ?? undefined,
            threadResolved: record.thread_resolved,
            threadResolvedAt: record.thread_resolved_at ?? undefined,
            threadResolvedByTournamentId: record.thread_resolved_by_tournament_id ?? undefined,
            threadResolvedByTournamentName: record.thread_resolved_by_tournament_name ?? undefined,
            sentAt: record.timestamp,
            receivedAt: record.created_at,
            timestamp: record.timestamp,
          },
        }));
      const unreadReceivedMessageIds = records
        .filter((record) => record.direction === "received" && !readMessageIds.has(record.id))
        .map((record) => record.id);

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
            matchCardId: record.match_card_id ?? undefined,
            matchSlot: toMatchSlot(record.match_slot),
            remoteDqTargetPlayerId: record.remote_dq_target_player_id ?? undefined,
            remoteDqTargetPlayerName: record.remote_dq_target_player_name ?? undefined,
            remoteDqTargetUserCode: record.remote_dq_target_user_code ?? undefined,
            remoteDqRequestedByTournamentId: record.remote_dq_requested_by_tournament_id ?? undefined,
            remoteDqRequestedByTournamentName: record.remote_dq_requested_by_tournament_name ?? undefined,
            remoteDqApproved: record.remote_dq_approved,
            isDuplicateTournamentId: record.is_duplicate_tournament_id,
            threadId: record.thread_id ?? undefined,
            parentMessageId: record.parent_message_id ?? undefined,
            rootMessageId: record.root_message_id ?? undefined,
            threadResolved: record.thread_resolved,
            threadResolvedAt: record.thread_resolved_at ?? undefined,
            threadResolvedByTournamentId: record.thread_resolved_by_tournament_id ?? undefined,
            threadResolvedByTournamentName: record.thread_resolved_by_tournament_name ?? undefined,
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
          matchCardId: record.match_card_id ?? undefined,
          matchSlot: toMatchSlot(record.match_slot),
          remoteDqTargetPlayerId: record.remote_dq_target_player_id ?? undefined,
          remoteDqTargetPlayerName: record.remote_dq_target_player_name ?? undefined,
          remoteDqTargetUserCode: record.remote_dq_target_user_code ?? undefined,
          remoteDqRequestedByTournamentId: record.remote_dq_requested_by_tournament_id ?? undefined,
          remoteDqRequestedByTournamentName: record.remote_dq_requested_by_tournament_name ?? undefined,
          remoteDqApproved: record.remote_dq_approved,
          isDuplicateTournamentId: record.is_duplicate_tournament_id,
          threadId: record.thread_id ?? undefined,
          parentMessageId: record.parent_message_id ?? undefined,
          rootMessageId: record.root_message_id ?? undefined,
          threadResolved: record.thread_resolved,
          threadResolvedAt: record.thread_resolved_at ?? undefined,
          threadResolvedByTournamentId: record.thread_resolved_by_tournament_id ?? undefined,
          threadResolvedByTournamentName: record.thread_resolved_by_tournament_name ?? undefined,
          sentAt: record.timestamp,
          receivedAt: record.created_at,
          timestamp: record.timestamp,
        },
      }));

      seenMessageIds.current = new Set([
        ...records.map((record) => record.id),
        ...unmatchedRecords.map((record) => record.id),
      ]);
      dispatch({
        type: "HYDRATE_MESSAGES",
        receivedMessages: received,
        sentMessages: sent,
        unmatchedMessages: unmatched,
        unreadReceivedMessageIds,
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

        // StrictMode や短時間の重複受信で同一IDが並行処理されるのを防ぐため、
        // 非同期処理開始前にロックする。
        seenMessageIds.current.add(messageId);

        void (async () => {
          const sameEventTournaments = await getTournamentsByEventCode(message.eventId);
          const targets = normalizeTargetTournamentIds(message.targetTournamentIds);
          const acceptedTournaments = sameEventTournaments.filter((t) => {
            return matchesTournamentDestination(t, targets);
          });

          message.receivedAt = nowIso();
          message.sentAt = message.sentAt ?? message.timestamp;

          if (acceptedTournaments.length === 0) {
            await persistUnmatchedMessage(message);
            if (tournament) {
              dispatch({ type: "ADD_UNMATCHED_MESSAGE", message });
            }
            return;
          }

          if (tournament && acceptedTournaments.some((t) => t.id === tournament.id)) {
            dispatch({
              type: "RECEIVE_MESSAGE",
              message,
              markAsUnread: true,
            });
            notifyIncomingMessage(message);
            void maybeSendTournamentIdCheckResult(message);
          }

          const persistResults = await Promise.allSettled(
            acceptedTournaments.map((accepted) =>
              persistMessageForTournament(accepted.id, message, "received")
            )
          );
          for (const result of persistResults) {
            if (result.status === "rejected") {
              console.error("[Message] Failed to persist incoming message", result.reason);
            }
          }
        })().catch((error) => {
          seenMessageIds.current.delete(messageId);
          console.error("[Message] Failed to distribute incoming message", error);
        });
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
    persistMessageForTournament,
    persistUnmatchedMessage,
    notifyIncomingMessage,
  ]);

  useEffect(() => {
    const currentTournamentId = tournament?.id ?? null;
    const previousTournamentId = previousTournamentIdRef.current;
    if (previousTournamentId && previousTournamentId !== currentTournamentId) {
      updateTournamentLastSeen(previousTournamentId);
    }
    previousTournamentIdRef.current = currentTournamentId;
  }, [tournament?.id, updateTournamentLastSeen]);

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
      matchCardId?: string;
      matchSlot?: 1 | 2;
      remoteDqTargetPlayerId?: string;
      remoteDqTargetPlayerName?: string;
      remoteDqTargetUserCode?: string;
      remoteDqRequestedByTournamentId?: string;
      remoteDqRequestedByTournamentName?: string;
      remoteDqApproved?: boolean;
      threadId?: string;
      parentMessageId?: string;
      rootMessageId?: string;
      threadResolved?: boolean;
      threadResolvedAt?: string;
      threadResolvedByTournamentId?: string;
      threadResolvedByTournamentName?: string;
    }): Promise<void> => {
      if (!tournament) throw new Error("大会が選択されていません");

      const normalizedThreadId =
        input.threadId ?? input.rootMessageId ?? input.parentMessageId ?? undefined;
      const normalizedRootMessageId =
        input.rootMessageId ?? normalizedThreadId;

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
        matchCardId: input.matchCardId,
        matchSlot: input.matchSlot,
        remoteDqTargetPlayerId: input.remoteDqTargetPlayerId,
        remoteDqTargetPlayerName: input.remoteDqTargetPlayerName,
        remoteDqTargetUserCode: input.remoteDqTargetUserCode,
        remoteDqRequestedByTournamentId: input.remoteDqRequestedByTournamentId,
        remoteDqRequestedByTournamentName: input.remoteDqRequestedByTournamentName,
        remoteDqApproved: input.remoteDqApproved,
        threadId: normalizedThreadId,
        parentMessageId: input.parentMessageId,
        rootMessageId: normalizedRootMessageId,
        threadResolved: input.threadResolved,
        threadResolvedAt: input.threadResolvedAt,
        threadResolvedByTournamentId: input.threadResolvedByTournamentId,
        threadResolvedByTournamentName: input.threadResolvedByTournamentName,
        sentAt: nowIso(),
        timestamp: nowIso(),
      };

      // 新規スレッドの場合（返信でない場合）
      if (!normalizedThreadId) {
        message.threadId = message.messageId;
        message.rootMessageId = message.messageId;
      }

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
        unreadReceivedCount: state.unreadReceivedCount,
        isReceivedMessageUnread: (messageId: string) =>
          state.unreadReceivedMessageIds.includes(messageId),
        markReceivedMessageRead,
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
    unreadReceivedCount: context.unreadReceivedCount,
    isReceivedMessageUnread: context.isReceivedMessageUnread,
    markReceivedMessageRead: context.markReceivedMessageRead,
    sendMessage: context.sendMessage,
  };
}


