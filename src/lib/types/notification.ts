// =====================
// Notification System
// =====================
// サーバーレス（UDPブロードキャスト）で動作する
// LANマルチトーナメント運用通知システムの型定義

/**
 * 複合メッセージID
 * 形式: `[イベントID]_[大会ID]_[タイムスタンプやランダム文字列]`
 * サーバーなしでネットワーク全体で一意に識別できる。
 */
export type CompositeMessageId = string;

/**
 * ユーザーコード (既存仕様)
 * 形式: `[イベントID]-[大会ID]-[ユーザーID]-[ユーザー名の一部]`
 */
export type UserCode = string;

// =====================
// Message Core
// =====================

/**
 * CALL: 呼出
 * TOURNAMENT_ID_CHECK: 大会ID確認
 * GENERAL: 汎用
 * TOURNAMENT_ID_CHECK_RESULT: 大会ID確認の自動応答
 */
export type MessageAttribute =
  | "CALL"
  | "TOURNAMENT_ID_CHECK"
  | "GENERAL"
  | "TOURNAMENT_ID_CHECK_RESULT"
  | "THREAD_RESOLVED"
  | "REMOTE_DQ_REQUEST"
  | "REMOTE_DQ_APPROVED";

export interface NotificationMessage {
  /** 複合メッセージID */
  messageId: CompositeMessageId;
  /** イベントID */
  eventId: string;
  /** 送信元大会のDB上のID */
  sourceTournamentDbId?: string;
  /** 送信元大会ID */
  sourceTournamentId: string;
  /** 送信元大会名 */
  sourceTournamentName: string;
  /** メッセージ属性 */
  attribute: MessageAttribute;
  /** タイトル */
  title: string;
  /** 本文 */
  body: string;
  /** 自由入力コメント（最大300文字） */
  comment?: string;
  /**
   * 送信先大会IDの指定。
   * 未指定 or 空配列なら無差別送信（ブロードキャスト）として扱う。
   */
  targetTournamentIds?: string[];

  /** CALL 用: 対象プレイヤーID */
  targetPlayerId?: string;
  /** CALL 用: 対象プレイヤー名 */
  targetPlayerName?: string;
  /** CALL 用: 対象ユーザーコード */
  targetUserCode?: UserCode;

  /** TOURNAMENT_ID_CHECK 用: 確認対象の大会ID */
  requestedTournamentId?: string;
  /** TOURNAMENT_ID_CHECK_RESULT 用: 重複有無 */
  isDuplicateTournamentId?: boolean;

  /** 呼び出しカード識別子 (例: W-R1-M2) */
  matchCardId?: string;
  /** 呼び出し対象スロット (1 or 2) */
  matchSlot?: 1 | 2;

  /** リモートDQ申請用: 申請対象プレイヤー */
  remoteDqTargetPlayerId?: string;
  remoteDqTargetPlayerName?: string;
  remoteDqTargetUserCode?: string;
  remoteDqRequestedByTournamentId?: string;
  remoteDqRequestedByTournamentName?: string;
  remoteDqForAllMatches?: boolean;

  /** リモートDQ承認用 */
  remoteDqApproved?: boolean;

  /** スレッドID。初回メッセージでは messageId を入れる */
  threadId?: string;
  /** 親メッセージID。返信時のみ設定する */
  parentMessageId?: string;
  /** スレッドの起点となるメッセージID */
  rootMessageId?: string;

  /** スレッド解決イベント用: 解決状態 */
  threadResolved?: boolean;
  /** スレッド解決イベント用: 解決時刻 (ISO 8601) */
  threadResolvedAt?: string;
  /** スレッド解決イベント用: 解決した大会ID */
  threadResolvedByTournamentId?: string;
  /** スレッド解決イベント用: 解決した大会名 */
  threadResolvedByTournamentName?: string;

  /** 送信時刻 (ISO 8601) */
  sentAt: string;
  /** 受信時刻 (ISO 8601) */
  receivedAt?: string;

  /** 送信タイムスタンプ (ISO 8601) */
  timestamp: string;
}

// =====================
// Backward compatibility (temporary aliases)
// =====================
export type ReplyType = "ABSENT" | "PLAYING" | "GOING" | "DQ";
export type ResolvedReason = "FOUND" | "DQ_FORCE" | "DQ_USER";

// =====================
// UDP ペイロード (送受信ラッパー)
// =====================

export type NotificationMessageType = "MESSAGE";

export type MessagePayload = { type: "MESSAGE"; data: NotificationMessage };



