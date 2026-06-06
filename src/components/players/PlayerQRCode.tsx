import { useState } from "react";
import QRCode from "react-qr-code";
import type { Player } from "../../lib/types";

interface Props {
  player: Player;
}

export function PlayerQRCode({ player }: Props) {
  const [show, setShow] = useState(false);

  const qrData = JSON.stringify({
    id: player.id,
    name: player.name,
    character_name: player.character_name,
    attributes: player.attributes,
  });

  return (
    <div>
      <button
        onClick={() => setShow(!show)}
        className="text-xs text-blue-600 hover:underline"
      >
        {show ? "QRを閉じる" : "QRコード表示"}
      </button>
      {show && (
        <div className="mt-2 p-3 bg-white inline-block rounded shadow">
          <QRCode value={qrData} size={160} />
          <p className="text-xs text-gray-500 mt-1 text-center max-w-[160px] break-all">
            {player.name}
          </p>
        </div>
      )}
    </div>
  );
}
