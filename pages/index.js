// pages/index.js
import { useState, useRef } from "react";
import TargetTealLogo from "./TargetTealLogo";

// Import do Firebase Storage
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { storage } from "../lib/firebase";

export default function Home() {
  // --- Estados & Refs para WebRTC / Realtime API ---
  const [isConnected, setIsConnected] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const pcRef = useRef(null);        // RTCPeerConnection
  const micStreamRef = useRef(null); // stream do microfone
  const dataChannelRef = useRef(null);

  // --- Estados & Refs para Gravação ---
  const recorderRef = useRef(null);  
  const [downloadUrl, setDownloadUrl] = useState(null);  // Link local
  const [uploadProgress, setUploadProgress] = useState(0);
  const [firebaseUrl, setFirebaseUrl] = useState(null);

  // Botão "Iniciar"
  async function startRealtimeSession() {
    try {
      // 1. Buscar token efêmero de /api/session
      const ephemeralResponse = await fetch("/api/session");
      const ephemeralData = await ephemeralResponse.json();
      const EPHEMERAL_KEY = ephemeralData.client_secret.value;

      // 2. Criar PeerConnection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // 3. Criar elemento <audio> para tocar o áudio remoto
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      pc.ontrack = (event) => {
        audioEl.srcObject = event.streams[0];
      };

      // 4. Microfone local => addTrack
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = micStream;
      pc.addTrack(micStream.getTracks()[0]);

      // 5. DataChannel => troca mensagens Realtime (text events)
      const dc = pc.createDataChannel("oai-events");
      dataChannelRef.current = dc;

      dc.addEventListener("message", (event) => {
        console.log("Recebido do modelo:", event.data);
        // Logo pisca (glow) indicando "fala" do assistente
        setIsAssistantSpeaking(true);
        setTimeout(() => setIsAssistantSpeaking(false), 3000);
      });

      // 6. Criar offer e setar descrição local
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // 7. Enviar a Offer SDP para OpenAI Realtime
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

      // 8. Definir descrição remota com a answer
      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      // 9. Atualizar "system prompt" do modelo => Cardus
      const systemEvent = {
        type: "session.update",
        session: {
          instructions: `
            Você é um entrevistador chamado Cardus, interessado em coletar histórias 
            e narrativas de pessoas que trabalham na TechFunction. 
            Estimule o usuário a contar histórias, sem julgamentos. 
            Tudo será anonimizado. Não ofereça soluções, apenas colete.
          `,
        },
      };
      dc.send(JSON.stringify(systemEvent));

      // 10. Iniciar gravação local do microfone
      const mediaRecorder = new MediaRecorder(micStream, {
        mimeType: "audio/webm",
      });

      const chunks = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        // Ao parar, criamos Blob => link local => e subimos p/ Firebase
        const blob = new Blob(chunks, { type: "audio/webm" });

        // Local download link
        const localUrl = URL.createObjectURL(blob);
        setDownloadUrl(localUrl);

        // Upload p/ Firebase
        await uploadToFirebase(blob);
      };

      mediaRecorder.start();
      recorderRef.current = mediaRecorder;

      // Conectado
      setIsConnected(true);
      console.log("Conectado ao Realtime API via WebRTC");
    } catch (error) {
      console.error("Erro ao iniciar sessão:", error);
    }
  }

  // Botão "Encerrar"
  function endInterview() {
    // 1. Fechar RTCPeerConnection
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    // 2. Parar Recorder
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop(); // dispara onstop => gera blob => faz upload
      recorderRef.current = null;
    }
    // 3. Parar Tracks do mic
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    // Reset
    setIsConnected(false);
    setIsAssistantSpeaking(false);
    console.log("Entrevista encerrada.");
  }

  // Upload do Blob para Firebase
  async function uploadToFirebase(blob) {
    try {
      const fileName = `entrevistas/entrevista-${Date.now()}.webm`;
      const fileRef = ref(storage, fileName);

      const uploadTask = uploadBytesResumable(fileRef, blob);

      // Progresso
      uploadTask.on("state_changed", (snapshot) => {
        const percent = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        setUploadProgress(percent.toFixed(0));
      });

      const snapshot = await uploadTask;
      // Ao finalizar => getDownloadURL
      const fbUrl = await getDownloadURL(snapshot.ref);
      setFirebaseUrl(fbUrl);
      console.log("Arquivo enviado ao Firebase:", fbUrl);
    } catch (error) {
      console.error("Erro no upload para Firebase:", error);
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.logoContainer}>
        <TargetTealLogo isSpeaking={isAssistantSpeaking} />
      </div>

      <div style={styles.content}>
        <h1 style={styles.title}>Realtime Voice Agent Demo (Next.js + Firebase)</h1>

        <div style={{ marginBottom: "1rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
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

        {/* Cardus (Entrevistador) */}
        <div style={styles.interviewerBox}>
          <h2 style={{ marginBottom: "1rem" }}>Cardus (Entrevistador)</h2>
          <p>
            Você é um entrevistado que trabalha em uma organização chamada TechFunction. 
            Estou interessado em coletar histórias e narrativas sobre sua experiência. 
            Essas narrativas serão usadas para entender o clima e a cultura organizacional. 
            Tudo será anonimizado, então fique tranquilo! Meu trabalho não é sugerir soluções, 
            apenas coletar histórias.
          </p>
        </div>

        {/* Exibir link de download local, caso exista */}
        {downloadUrl && (
          <div style={styles.downloadContainer}>
            <p>Áudio Gravado (Local):</p>
            <audio controls src={downloadUrl} />
            <br />
            <a href={downloadUrl} download="entrevista.webm">
              Baixar Arquivo WEBM
            </a>
          </div>
        )}

        {/* Progresso do Upload (Firebase) */}
        {uploadProgress > 0 && uploadProgress < 100 && (
          <p style={{ marginTop: "1rem" }}>
            Enviando ao Firebase: {uploadProgress}%
          </p>
        )}
        {uploadProgress === "100" && (
          <p>Upload Concluído!</p>
        )}

        {/* Link final do Firebase */}
        {firebaseUrl && (
          <div style={styles.downloadContainer}>
            <p>Link no Firebase:</p>
            <a href={firebaseUrl} target="_blank" rel="noreferrer">
              {firebaseUrl}
            </a>
            <br />
            <audio controls src={firebaseUrl} />
          </div>
        )}
      </div>
    </div>
  );
}

// Estilos em JS
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
  interviewerBox: {
    textAlign: "left",
    backgroundColor: "#2B2B2B",
    padding: "1rem",
    borderRadius: "6px",
    marginTop: "1rem",
  },
  downloadContainer: {
    marginTop: "2rem",
  },
};
