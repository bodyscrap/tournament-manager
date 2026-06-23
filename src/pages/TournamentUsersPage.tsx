import { useEffect, useMemo, useState } from "react";
import { useAppContext } from "../context/AppContext";
import { SafeQRCode } from "../components/common/SafeQRCode";
import { QrScannerDialog } from "../components/common/QrScannerDialog";
import { exportA4SheetImages, exportSingleCardImage, type ExportCardItem } from "../lib/cardExport";
import { extractUserCode, normalizeEventCode } from "../lib/playerCode";

type UserRole = "participant" | "admin";

type UserListRow = {
  rowId: string;
  userId4: string;
  userName: string;
  role: UserRole;
  roleLabel: string;
  exportItem: ExportCardItem;
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

export function TournamentUsersPage() {
  const {
    tournament,
    participants,
    admins,
    addAdmin,
    editAdminName,
    removeAdmin,
    isReadOnly,
  } = useAppContext();
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [previewRow, setPreviewRow] = useState<UserListRow | null>(null);
  const [savingCards, setSavingCards] = useState(false);
  const [savingSheets, setSavingSheets] = useState(false);
  const [showAdminAuthDialog, setShowAdminAuthDialog] = useState(false);
  const [showAdminQrScan, setShowAdminQrScan] = useState(false);
  const [adminAuthCode, setAdminAuthCode] = useState("");
  const [authenticatedAdminId, setAuthenticatedAdminId] = useState<string | null>(null);
  const [newAdminName, setNewAdminName] = useState("");
  const [savingAdmin, setSavingAdmin] = useState(false);
  const [isUserCardAccessBlocked, setIsUserCardAccessBlocked] = useState(false);

  const authenticatedAdmin = useMemo(
    () => admins.find((a) => a.admin_id === authenticatedAdminId) ?? null,
    [admins, authenticatedAdminId]
  );

  const rows = useMemo<UserListRow[]>(() => {
    if (!tournament) return [];

    const participantRows = [...participants]
      .sort((a, b) => a.seed - b.seed)
      .map((p) => ({
        rowId: `participant:${p.player_id}`,
        userId4: p.player_id_4,
        userName: p.name,
        role: "participant" as const,
        roleLabel: "参加者",
        exportItem: {
          entityType: "participant" as const,
          id: `participant:${p.player_id}`,
          name: p.name,
          userCode: p.player_code,
          eventCode: tournament.event_code,
          tournamentCode: tournament.tournament_code,
          tournamentName: tournament.name,
          qrPayload: p.player_code,
        },
      }));

    const adminRows = [...admins]
      .sort((a, b) => a.admin_sequence - b.admin_sequence)
      .map((a) => ({
        rowId: `admin:${a.admin_id}`,
        userId4: a.admin_id_4,
        userName: a.name,
        role: "admin" as const,
        roleLabel: "管理者",
        exportItem: {
          entityType: "admin" as const,
          id: `admin:${a.admin_id}`,
          name: a.name,
          userCode: a.admin_code,
          eventCode: tournament.event_code,
          tournamentCode: tournament.tournament_code,
          tournamentName: tournament.name,
          qrPayload: a.admin_code,
        },
      }));

    return [...participantRows, ...adminRows];
  }, [participants, admins, tournament]);

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedRowIds.has(row.rowId)),
    [rows, selectedRowIds]
  );
  const selectedAdminRows = useMemo(
    () => selectedRows.filter((row) => row.role === "admin"),
    [selectedRows]
  );
  const cardAccessStorageKey = useMemo(
    () => (tournament ? `tournament-user-card-access-blocked:${tournament.id}` : ""),
    [tournament]
  );
  const currentEventCode = normalizeEventCode(tournament?.event_code ?? "0000");

  useEffect(() => {
    setSelectedRowIds((prev) => {
      if (prev.size === 0) return prev;
      const rowIdSet = new Set(rows.map((row) => row.rowId));
      const next = new Set<string>();
      for (const id of prev) {
        if (rowIdSet.has(id)) next.add(id);
      }
      return next;
    });

    setAnchorIndex((prev) => {
      if (prev === null) return null;
      if (prev < 0 || prev >= rows.length) return null;
      return prev;
    });
  }, [rows]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier || key !== "a") return;
      if (isEditableTarget(event.target)) return;

      if (event.shiftKey) {
        if (selectedRowIds.size !== 1) return;

        const currentId = Array.from(selectedRowIds)[0];
        const currentIndex = rows.findIndex((row) => row.rowId === currentId);
        if (currentIndex < 0) return;

        const currentRole = rows[currentIndex].role;
        const sameRoleIds = rows.filter((row) => row.role === currentRole).map((row) => row.rowId);
        if (sameRoleIds.length === 0) return;

        event.preventDefault();
        setSelectedRowIds(new Set(sameRoleIds));
        setAnchorIndex(currentIndex);
        return;
      }

      event.preventDefault();
      setSelectedRowIds(new Set(rows.map((row) => row.rowId)));
      setAnchorIndex(rows.length > 0 ? 0 : null);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [rows, selectedRowIds]);

  useEffect(() => {
    if (!authenticatedAdminId) return;
    if (admins.some((a) => a.admin_id === authenticatedAdminId)) return;
    setAuthenticatedAdminId(null);
  }, [admins, authenticatedAdminId]);

  useEffect(() => {
    return () => {
      setAuthenticatedAdminId(null);
    };
  }, []);

  useEffect(() => {
    if (!cardAccessStorageKey) return;
    const saved = localStorage.getItem(cardAccessStorageKey);
    setIsUserCardAccessBlocked(saved === "1");
  }, [cardAccessStorageKey]);

  useEffect(() => {
    if (!cardAccessStorageKey) return;
    localStorage.setItem(cardAccessStorageKey, isUserCardAccessBlocked ? "1" : "0");
  }, [cardAccessStorageKey, isUserCardAccessBlocked]);

  useEffect(() => {
    if (!isUserCardAccessBlocked) return;
    setPreviewRow(null);
  }, [isUserCardAccessBlocked]);

  if (!tournament) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center text-gray-500">
          大会が選択されていません。大会一覧から大会を選択してください。
        </div>
      </div>
    );
  }

  const handleRowClick = (
    event: React.MouseEvent<HTMLTableRowElement>,
    index: number,
    rowId: string
  ) => {
    const withModifier = event.ctrlKey || event.metaKey;

    if (event.shiftKey && anchorIndex !== null) {
      const start = Math.min(anchorIndex, index);
      const end = Math.max(anchorIndex, index);
      const rangeIds = rows.slice(start, end + 1).map((row) => row.rowId);

      if (withModifier) {
        setSelectedRowIds((prev) => {
          const next = new Set(prev);
          for (const id of rangeIds) next.add(id);
          return next;
        });
      } else {
        setSelectedRowIds(new Set(rangeIds));
      }
      return;
    }

    if (withModifier) {
      setSelectedRowIds((prev) => {
        const next = new Set(prev);
        if (next.has(rowId)) {
          next.delete(rowId);
        } else {
          next.add(rowId);
        }
        return next;
      });
      setAnchorIndex(index);
      return;
    }

    setSelectedRowIds(new Set([rowId]));
    setAnchorIndex(index);
  };

  const handleSaveSelectedCards = async () => {
    if (isUserCardAccessBlocked) {
      alert("ユーザーカードの閲覧/保存は禁止中です。管理者操作から解除してください。");
      return;
    }

    if (selectedRows.length === 0) {
      alert("ユーザーを選択してください。");
      return;
    }

    setSavingCards(true);
    try {
      for (const row of selectedRows) {
        // eslint-disable-next-line no-await-in-loop
        await exportSingleCardImage(row.exportItem);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "ユーザーカード画像の保存に失敗しました");
    } finally {
      setSavingCards(false);
    }
  };

  const handleSaveSelectedSheets = async () => {
    if (isUserCardAccessBlocked) {
      alert("ユーザーカードの閲覧/保存は禁止中です。管理者操作から解除してください。");
      return;
    }

    if (selectedRows.length === 0) {
      alert("ユーザーを選択してください。");
      return;
    }

    setSavingSheets(true);
    try {
      await exportA4SheetImages(
        selectedRows.map((row) => row.exportItem),
        `${tournament.name}_selected_users`
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "印刷用画像の保存に失敗しました");
    } finally {
      setSavingSheets(false);
    }
  };

  const handleToggleUserCardAccess = async () => {
    if (isReadOnly || !authenticatedAdminId) return;

    if (isUserCardAccessBlocked) {
      setIsUserCardAccessBlocked(false);
      alert("ユーザーカード閲覧/保存の禁止を解除しました。");
      return;
    }

    if (admins.length === 0) {
      alert("管理者が存在しないため設定できません。");
      return;
    }

    const backupAdmin = [...admins].sort((a, b) => {
      const aid = Number.parseInt(a.admin_id_4, 10);
      const bid = Number.parseInt(b.admin_id_4, 10);
      const aNum = Number.isNaN(aid) ? Number.MAX_SAFE_INTEGER : aid;
      const bNum = Number.isNaN(bid) ? Number.MAX_SAFE_INTEGER : bid;
      if (aNum !== bNum) return aNum - bNum;
      return a.admin_sequence - b.admin_sequence;
    })[0];

    const confirmed = confirm(
      `ユーザーカード閲覧/保存を禁止しますか？\n\n` +
      `禁止前に復旧用として最小番号の管理者カード（${backupAdmin.admin_id_4}: ${backupAdmin.name}）を保存します。`
    );
    if (!confirmed) return;

    try {
      await exportSingleCardImage({
        entityType: "admin",
        id: `admin:${backupAdmin.admin_id}`,
        name: backupAdmin.name,
        userCode: backupAdmin.admin_code,
        eventCode: tournament.event_code,
        tournamentCode: tournament.tournament_code,
        tournamentName: tournament.name,
        qrPayload: backupAdmin.admin_code,
      });
      setIsUserCardAccessBlocked(true);
      alert("復旧用管理者カードを保存し、ユーザーカード閲覧/保存を禁止しました。");
    } catch (err) {
      alert(err instanceof Error ? err.message : "復旧用管理者カードの保存に失敗したため、禁止設定を中止しました。");
    }
  };

  const resolveAdminByCode = (raw: string) => {
    const normalized = extractUserCode(raw);
    if (!normalized || !normalized.startsWith(currentEventCode)) return null;
    return admins.find((a) => extractUserCode(a.admin_code) === normalized) ?? null;
  };

  const handleAuthenticateAdminCode = (rawCode: string) => {
    const admin = resolveAdminByCode(rawCode);
    if (!admin) {
      alert("有効な管理者コードではありません");
      return;
    }
    setAuthenticatedAdminId(admin.admin_id);
    setAdminAuthCode("");
    setShowAdminAuthDialog(false);
    alert(`管理者「${admin.name}」を認証しました`);
  };

  const handleAddAdmin = async () => {
    if (isReadOnly || !authenticatedAdminId) return;
    const trimmed = newAdminName.trim();
    if (!trimmed) {
      alert("管理者名を入力してください");
      return;
    }

    setSavingAdmin(true);
    try {
      await addAdmin(trimmed);
      setNewAdminName("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "管理者の追加に失敗しました");
    } finally {
      setSavingAdmin(false);
    }
  };

  const handleEditAdmin = async () => {
    if (isReadOnly || !authenticatedAdminId) return;
    if (selectedAdminRows.length !== 1) {
      alert("編集するには管理者を1人だけ選択してください");
      return;
    }

    const target = selectedAdminRows[0];
    const current = admins.find((a) => `admin:${a.admin_id}` === target.rowId);
    if (!current) {
      alert("管理者情報の取得に失敗しました");
      return;
    }

    const nextName = prompt("管理者名を入力してください", current.name);
    if (nextName === null) return;
    const trimmed = nextName.trim();
    if (!trimmed) {
      alert("管理者名を入力してください");
      return;
    }

    try {
      await editAdminName(current.admin_id, trimmed);
    } catch (err) {
      alert(err instanceof Error ? err.message : "管理者名の更新に失敗しました");
    }
  };

  const handleDeleteAdmins = async () => {
    if (isReadOnly || !authenticatedAdminId) return;
    if (selectedAdminRows.length === 0) {
      alert("削除する管理者を選択してください");
      return;
    }

    if (admins.length - selectedAdminRows.length <= 0) {
      alert("削除を行うと管理者が0名になるため削除できません");
      return;
    }

    const selectedNames = selectedAdminRows.map((row) => row.userName).join("、");
    const ok = confirm(
      `選択中の管理者 ${selectedAdminRows.length} 名を削除しますか？\n\n対象: ${selectedNames}`
    );
    if (!ok) return;

    try {
      for (const row of selectedAdminRows) {
        const current = admins.find((a) => `admin:${a.admin_id}` === row.rowId);
        if (!current) continue;
        // eslint-disable-next-line no-await-in-loop
        await removeAdmin(current.admin_id);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "管理者の削除に失敗しました");
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-gray-800">ユーザーリスト</h2>
        <p className="text-sm text-gray-500 mt-1">
          大会: {tournament.name} / コード: <span className="font-mono">{tournament.tournament_code}</span>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowAdminAuthDialog(true)}
            className="px-3 py-1.5 text-sm bg-amber-600 hover:bg-amber-700 text-white rounded-lg"
          >
            管理者認証
          </button>
          {authenticatedAdmin ? (
            <>
              <span className="text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-800">
                認証済み: {authenticatedAdmin.admin_id_4} / {authenticatedAdmin.name}
              </span>
              <button
                onClick={() => setAuthenticatedAdminId(null)}
                className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
              >
                認証解除
              </button>
            </>
          ) : (
            <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600">未認証</span>
          )}
        </div>
        {isReadOnly && (
          <p className="text-xs text-amber-700 mt-1">この大会は閲覧専用です。管理者認証済みでも編集操作はできません。</p>
        )}
        <p className="text-xs text-gray-500 mt-2">
          行クリックで選択。Ctrl+クリックで複数選択、Shift+クリックで範囲選択、Ctrl+Aで全選択、Ctrl+Shift+Aで同属性ユーザーを全選択。
        </p>
      </div>

      {authenticatedAdminId && !isReadOnly && (
        <div className="mb-4 bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <p className="text-sm font-semibold text-gray-700 mb-2">管理者操作</p>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <input
              value={newAdminName}
              onChange={(e) => setNewAdminName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleAddAdmin()}
              placeholder="追加する管理者名"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[240px]"
            />
            <button
              onClick={() => void handleAddAdmin()}
              disabled={savingAdmin || !newAdminName.trim()}
              className="px-3 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
            >
              {savingAdmin ? "追加中..." : "管理者を追加"}
            </button>
            <button
              onClick={() => void handleEditAdmin()}
              disabled={selectedAdminRows.length !== 1}
              className="px-3 py-2 text-sm rounded-lg bg-sky-100 hover:bg-sky-200 text-sky-700 disabled:opacity-50"
            >
              管理者を編集
            </button>
            <button
              onClick={() => void handleDeleteAdmins()}
              disabled={selectedAdminRows.length === 0}
              className="px-3 py-2 text-sm rounded-lg bg-red-100 hover:bg-red-200 text-red-700 disabled:opacity-50"
            >
              管理者を削除
            </button>
            <button
              onClick={() => void handleToggleUserCardAccess()}
              className={`px-3 py-2 text-sm rounded-lg text-white ${
                isUserCardAccessBlocked
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : "bg-amber-600 hover:bg-amber-700"
              }`}
            >
              {isUserCardAccessBlocked
                ? "ユーザーカード閲覧/保存の禁止を解除"
                : "ユーザーカード閲覧/保存を禁止"}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">管理者の編集は1名選択時のみ可能です。削除は選択中の管理者のみ対象です。</p>
          <p className={`text-xs mt-1 ${isUserCardAccessBlocked ? "text-red-700" : "text-gray-500"}`}>
            ユーザーカード閲覧/保存: {isUserCardAccessBlocked ? "禁止中" : "許可中"}
          </p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button
            onClick={handleSaveSelectedCards}
            disabled={isUserCardAccessBlocked || savingCards || selectedRows.length === 0}
            className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50"
          >
            {savingCards ? "保存中..." : "ユーザーカード画像を保存"}
          </button>
          <button
            onClick={handleSaveSelectedSheets}
            disabled={isUserCardAccessBlocked || savingSheets || selectedRows.length === 0}
            className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50"
          >
            {savingSheets ? "生成中..." : "印刷用ユーザーカード画像を保存"}
          </button>
          <span className="text-xs text-gray-500">選択中: {selectedRows.length} / {rows.length}</span>
        </div>
        {isUserCardAccessBlocked && (
          <p className="text-xs text-red-700 mb-2">管理者操作でユーザーカード閲覧/保存が禁止されています。解除するまで表示・保存はできません。</p>
        )}

        {rows.length === 0 ? (
          <div className="p-6 text-center text-gray-500">参加者・管理者がまだ登録されていません。</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-200 text-gray-600">
                  <th className="px-3 py-2 w-24">ID</th>
                  <th className="px-3 py-2 w-64">ユーザー名</th>
                  <th className="px-3 py-2 w-32">属性</th>
                  <th className="px-3 py-2 w-40">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const selected = selectedRowIds.has(row.rowId);

                  return (
                    <tr
                      key={row.rowId}
                      onClick={(event) => handleRowClick(event, index, row.rowId)}
                      className={`border-b border-gray-100 cursor-pointer ${
                        selected ? "bg-blue-50" : "hover:bg-gray-50"
                      }`}
                    >
                      <td className="px-3 py-2 font-mono text-gray-700">{row.userId4}</td>
                      <td className="px-3 py-2 text-gray-800">{row.userName}</td>
                      <td className="px-3 py-2">
                        <div className="inline-flex items-center gap-1.5">
                          <span
                            className={`text-base leading-none ${
                              row.role === "admin"
                                ? authenticatedAdminId
                                  ? "text-emerald-600"
                                  : "text-amber-700"
                                : "text-sky-700"
                            }`}
                            title={row.roleLabel}
                          >
                            {row.role === "admin" ? "🛡️" : "👤"}
                          </span>
                          <span
                            className={`text-xs px-2 py-1 rounded ${
                              row.role === "admin"
                                ? authenticatedAdminId
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-amber-100 text-amber-800"
                                : "bg-sky-100 text-sky-800"
                            }`}
                          >
                            {row.roleLabel}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            if (isUserCardAccessBlocked) {
                              alert("ユーザーカードの閲覧/保存は禁止中です。管理者操作から解除してください。");
                              return;
                            }
                            setPreviewRow(row);
                          }}
                          disabled={isUserCardAccessBlocked}
                          className="text-xs px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-800 text-white whitespace-nowrap"
                        >
                          ユーザーカード
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {previewRow && !isUserCardAccessBlocked && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-xl border border-gray-200 shadow-xl p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-gray-800">{previewRow.userName}</h3>
                <p className="text-xs text-gray-500 mt-0.5">ID {previewRow.userId4} / {previewRow.roleLabel}</p>
              </div>
              <button
                onClick={() => setPreviewRow(null)}
                className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
              >
                閉じる
              </button>
            </div>

            <div className="mt-3 p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-500">ユーザーコード</p>
              <p className="font-mono text-sm text-gray-800 break-all">{previewRow.exportItem.userCode || "(未発行)"}</p>
              <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                大会コード: <span className="font-mono">{previewRow.exportItem.tournamentCode}</span>
                <br />
                大会名: {previewRow.exportItem.tournamentName}
              </p>
            </div>

            <div className="mt-3 p-3 bg-gray-50 rounded-lg flex items-center justify-center">
              <SafeQRCode value={previewRow.exportItem.qrPayload} size={184} />
            </div>
          </div>
        </div>
      )}

      {showAdminAuthDialog && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-xl border border-gray-200 shadow-xl p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-gray-800">管理者認証</h3>
                <p className="text-xs text-gray-500 mt-0.5">管理者のユーザーコードを入力、またはカメラで読み取ってください。</p>
              </div>
              <button
                onClick={() => {
                  setShowAdminAuthDialog(false);
                  setAdminAuthCode("");
                }}
                className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
              >
                閉じる
              </button>
            </div>

            <div className="mt-3 space-y-2">
              <input
                type="password"
                value={adminAuthCode}
                onChange={(e) => setAdminAuthCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const code = adminAuthCode.trim();
                    if (!code) {
                      alert("確認コードを入力してください");
                      return;
                    }
                    handleAuthenticateAdminCode(code);
                  }
                }}
                placeholder="管理者コードを入力"
                autoComplete="off"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    const code = adminAuthCode.trim();
                    if (!code) {
                      alert("確認コードを入力してください");
                      return;
                    }
                    handleAuthenticateAdminCode(code);
                  }}
                  className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  認証する
                </button>
                <button
                  onClick={() => setShowAdminQrScan(true)}
                  className="px-3 py-1.5 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  カメラで読み取り
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <QrScannerDialog
        open={showAdminQrScan}
        title="管理者コードを読み取り"
        onClose={() => setShowAdminQrScan(false)}
        onDetected={(value) => {
          setAdminAuthCode(value);
          handleAuthenticateAdminCode(value);
          setShowAdminQrScan(false);
        }}
      />
    </div>
  );
}
