import { useState, useRef } from "react";
import TargetTealLogo from "./TargetTealLogo";

// Se estiver usando o Firebase
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { storage } from "../lib/firebase";

export default function Home() {
  // Estados de controle
  const [isConnected, setIsConnected] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);

  // Referências para WebRTC
  const pcRef = useRef(null);         // PeerConnection
  const micStreamRef = useRef(null);  // Stream do microfone
  const dataChannelRef = useRef(null);

  // Referências e estados para gravação
  const recorderRef = useRef(null);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [firebaseUrl, setFirebaseUrl] = useState(null);

  // ========================
  // Iniciar sessão Realtime
  // ========================
  async function startRealtimeSession() {
    try {
      const ephemeralResponse = await fetch("/api/session");
      const ephemeralData = await ephemeralResponse.json();
      const EPHEMERAL_KEY = ephemeralData.client_secret.value;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      pc.ontrack = (event) => {
        audioEl.srcObject = event.streams[0];
      };

      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = micStream;
      pc.addTrack(micStream.getTracks()[0]);

      const dc = pc.createDataChannel("oai-events");
      dataChannelRef.current = dc;

      dc.addEventListener("open", () => {
        console.log("[DataChannel] Aberto!");
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const baseUrl = "https://api.openai.com/v1/realtime";
      const model = "gpt-4o-realtime-preview-2024-12-17";

      const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });

      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      const mediaRecorder = new MediaRecorder(micStream, {
        mimeType: "audio/webm",
      });

      const chunks = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        const localUrl = URL.createObjectURL(blob);
        setDownloadUrl(localUrl);
        uploadToFirebase(blob);
      };

      mediaRecorder.start();
      recorderRef.current = mediaRecorder;

      setIsConnected(true);
      console.log("Conectado ao Realtime API via WebRTC");
    } catch (error) {
      console.error("Erro ao iniciar sessão:", error);
    }
  }

  // ===========================
  // Encerrar sessão Realtime
  // ===========================
  function endInterview() {
    if (pcRef.current) pcRef.current.close();
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop();
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
    }

    setIsConnected(false);
    setIsAssistantSpeaking(false);
  }

  // ================
  // Upload Firebase
  // ================
  async function uploadToFirebase(blob) {
    try {
      const fileName = `entrevistas/entrevista-${Date.now()}.webm`;
      const fileRef = ref(storage, fileName);

      const uploadTask = uploadBytesResumable(fileRef, blob);

      uploadTask.on("state_changed", (snapshot) => {
        const percent = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        setUploadProgress(percent.toFixed(0));
      });

      const snapshot = await uploadTask;
      const fbUrl = await getDownloadURL(snapshot.ref);
      setFirebaseUrl(fbUrl);
    } catch (err) {
      console.error("Erro ao enviar ao Firebase:", err);
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.logoContainer}>
        <TargetTealLogo isSpeaking={isAssistantSpeaking} />
      </div>

      <div style={styles.content}>
        <h1 style={styles.title}>Cardus Realtime Interview + Firebase</h1>

        <div style={styles.buttonContainer}>
          <button
            onClick={startRealtimeSession}
            disabled={isConnected}
            style={styles.button}
          >
            {isConnected ? "Conectado!" : "Iniciar Realtime Chat"}
          </button>

          <button
            onClick={endInterview}
            disabled={!isConnected}
            style={{
              ...styles.button,
              backgroundColor: isConnected ? "#FF4444" : "#666",
            }}
          >
            Encerrar Entrevista
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    backgroundColor: "#121212",
    color: "#FFFFFF",
    minHeight: "100vh",
    padding: "2rem",
    fontFamily: "sans-serif",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  logoContainer: {
    marginBottom: "2rem",
  },
  content: {
    maxWidth: "600px",
    width: "100%",
    textAlign: "center",
    backgroundColor: "#1E1E1E",
    padding: "2rem",
    borderRadius: "8px",
    boxShadow: "0 0 10px rgba(0, 255, 255, 0.3)",
  },
  title: {
    marginBottom: "1rem",
  },
  buttonContainer: {
    display: "flex",
    justifyContent: "center",
    gap: "1rem",
  },
  button: {
    backgroundColor: "#00FFFF",
    color: "#000",
    border: "none",
    padding: "0.8rem 1.2rem",
    borderRadius: "4px",
    cursor: "pointer",
    fontWeight: "bold",
    minWidth: "200px",
  },
};
