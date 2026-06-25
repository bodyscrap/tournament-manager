import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

type DetectResult = { rawValue?: string };
type DetectorCtor = new (options?: { formats?: string[] }) => {
  detect: (source: ImageBitmapSource) => Promise<DetectResult[]>;
};

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  onDetected: (value: string) => void;
}

export function QrScannerDialog({ open, title, onClose, onDetected }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let stopped = false;

    const stopAll = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop();
        }
        streamRef.current = null;
      }
    };

    const run = async () => {
      setError(null);

      const Detector = (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("この環境ではカメラアクセスに未対応です。コードを手入力してください。");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (stopped) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
          return;
        }
        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const detector = Detector ? new Detector({ formats: ["qr_code"] }) : null;

        const detectWithJsQr = () => {
          const v = videoRef.current;
          const canvas = canvasRef.current;
          if (!v || !canvas || v.videoWidth <= 0 || v.videoHeight <= 0) return null;

          if (canvas.width !== v.videoWidth || canvas.height !== v.videoHeight) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
          }

          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return null;

          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const result = jsQR(image.data, image.width, image.height);
          return result?.data?.trim() || null;
        };

        const tick = async () => {
          if (stopped) return;
          const v = videoRef.current;
          if (!v || v.readyState < 2) {
            rafRef.current = requestAnimationFrame(() => {
              void tick();
            });
            return;
          }

          try {
            const raw = detector
              ? (await detector.detect(v))[0]?.rawValue?.trim() ?? null
              : detectWithJsQr();
            if (raw) {
              onDetected(raw);
              stopAll();
              onClose();
              return;
            }
          } catch {
            // keep scanning
          }

          rafRef.current = requestAnimationFrame(() => {
            void tick();
          });
        };

        void tick();
      } catch {
        setError("カメラにアクセスできませんでした。権限設定を確認してください。");
      }
    };

    void run();

    return () => {
      stopped = true;
      stopAll();
    };
  }, [open, onClose, onDetected]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold text-gray-800">{title}</h4>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            閉じる
          </button>
        </div>

        <div className="rounded-xl overflow-hidden border border-gray-200 bg-black">
          <video ref={videoRef} className="w-full h-72 object-cover" muted playsInline />
        </div>
        <canvas ref={canvasRef} className="hidden" />

        {error ? (
          <p className="text-xs text-red-600 mt-2">{error}</p>
        ) : (
          <p className="text-xs text-gray-500 mt-2">2次元バーコードをカメラにかざしてください。プレビュー映像から自動で読み取ります。</p>
        )}
      </div>
    </div>
  );
}



