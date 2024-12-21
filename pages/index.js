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
      // 1. Buscar token efêmero (client_secret)
      const ephemeralResponse = await fetch("/api/session");
      const ephemeralData = await ephemeralResponse.json();
      const EPHEMERAL_KEY = ephemeralData.client_secret.value;

      // 2. Criar PeerConnection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // 3. Criar elemento <audio> para reproduzir áudio remoto
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      pc.ontrack = (event) => {
        audioEl.srcObject = event.streams[0];
      };

      // 4. Obter microfone local
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = micStream;
      // Adicionar track do microfone ao PeerConnection
      pc.addTrack(micStream.getTracks()[0]);

      // 5. Criar DataChannel (para enviar e receber eventos de texto)
      const dc = pc.createDataChannel("oai-events");
      dataChannelRef.current = dc;

      // 5a. Quando o DC abrir, enviamos system prompt (Cardus)
      dc.addEventListener("open", () => {
        console.log("[DataChannel] Aberto! Enviando system prompt...");

        // System prompt via session.update
        const systemEvent = {
          type: "session.update",
          session: {
            instructions: `
              Você é um entrevistador chamado Cardus, interessado em coletar histórias
              e narrativas de pessoas que trabalham na TechFunction. 
              Estimule o usuário a contar histórias, sem julgamentos. 
              Tudo será anonimizado. Não ofereça soluções, apenas colete as histórias.
            `,
          },
        };
        dc.send(JSON.stringify(systemEvent));

        // Opcional: mandar um response.create para iniciar a conversa
        const welcomeEvent = {
          type: "response.create",
          response: {
            modalities: ["text"],
            instructions: "Olá! Podemos começar a entrevista?",
          },
        };
        dc.send(JSON.stringify(welcomeEvent));
      });

      // 5b. Ao receber mensagens do modelo
      dc.addEventListener("message", (event) => {
        console.log("Recebido do modelo:", event.data);

        // Indicamos que o assistente (modelo) "está falando"
        setIsAssistantSpeaking(true);
        setTimeout(() => setIsAssistantSpeaking(false), 3000);
      });

      // 6. Criar offer e setar descrição local
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // 7. Enviar offer para a OpenAI Realtime
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

      // 8. Receber answer e setar descrição remota
      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      // 9. Iniciar gravação local do microfone
      const mediaRecorder = new MediaRecorder(micStream, {
        mimeType: "audio/webm",
      });

      const chunks = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      // Quando parar a gravação
      mediaRecorder.onstop = () => {
        console.log("[MediaRecorder] Parou gravação. Gerando Blob...");
        const blob = new Blob(chunks, { type: "audio/webm" });

        // Gerar URL local p/ download
        const localUrl = URL.createObjectURL(blob);
        setDownloadUrl(localUrl);

        // (Opcional) Upload no Firebase
        uploadToFirebase(blob);
      };

      mediaRecorder.start();
      recorderRef.current = mediaRecorder;

      // Final: estamos conectados
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
    console.log("[endInterview] Iniciando encerramento...");

    // 1. Fechar PeerConnection
    if (pcRef.current) {
      console.log("Fechando PeerConnection...");
      pcRef.current.close();
      pcRef.current = null;
    }

    // 2. Parar gravação (se estiver gravando)
    if (recorderRef.current && recorderRef.current.state === "recording") {
      console.log("Parando MediaRecorder...");
      recorderRef.current.stop();
      recorderRef.current = null;
    }

    // 3. Parar as tracks do microfone
    if (micStreamRef.current) {
      console.log("Parando tracks do microfone...");
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    // Resetar estado
    setIsConnected(false);
    setIsAssistantSpeaking(false);

    console.log("Entrevista encerrada com sucesso.");
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

      // Esperar finalizar
      const snapshot = await uploadTask;
      const fbUrl = await getDownloadURL(snapshot.ref);
      setFirebaseUrl(fbUrl);
      console.log("Arquivo enviado ao Firebase:", fbUrl);
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

        {/* Link local para o áudio gravado */}
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

        {/* Progresso de upload */}
        {uploadProgress > 0 && uploadProgress < 100 && (
          <p style={{ marginTop: "1rem" }}>
            Enviando ao Firebase: {uploadProgress}%
          </p>
        )}
        {uploadProgress === "100" && <p>Upload Concluído!</p>}

        {/* Link final no Firebase */}
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
