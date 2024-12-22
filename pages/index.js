import { useState, useRef } from "react";
import TargetTealLogo from "./TargetTealLogo";

export default function Home() {
  const [isConnected, setIsConnected] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);

  const pcRef = useRef(null);
  const micStreamRef = useRef(null);
  const dataChannelRef = useRef(null);

  const audioContextRef = useRef(null);
  const destinationRef = useRef(null);

  const combinedRecorderRef = useRef(null);
  const [combinedDownloadUrl, setCombinedDownloadUrl] = useState(null);

  async function startRealtimeSession() {
    try {
      const ephemeralResponse = await fetch("/api/session");
      const ephemeralData = await ephemeralResponse.json();
      const EPHEMERAL_KEY = ephemeralData.client_secret.value;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;

      const destination = audioCtx.createMediaStreamDestination();
      destinationRef.current = destination;

      const assistantAudioEl = document.createElement("audio");
      assistantAudioEl.autoplay = true;

      pc.ontrack = (event) => {
        assistantAudioEl.srcObject = event.streams[0];

        const assistantSource = audioCtx.createMediaStreamSource(event.streams[0]);
        assistantSource.connect(destination);
      };

      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = micStream;

      pc.addTrack(micStream.getTracks()[0]);

      const userSource = audioCtx.createMediaStreamSource(micStream);
      userSource.connect(destination);

      const dc = pc.createDataChannel("oai-events");
      dataChannelRef.current = dc;

      dc.addEventListener("open", () => {
        const sessionUpdateEvent = {
          type: "session.update",
          session: {
            instructions: `
              Você é um entrevistador chamado Cardus, interessado em coletar histórias e narrativas de pessoas que trabalham em uma organização chamada TechFunction.
              Essas narrativas serão usadas para entender o clima e cultura organizacional.
      
              Estimule o usuário a contar histórias e não apenas dar opiniões e fazer julgamentos. 
              O objetivo desse trabalho é fazer um mapeamento dessas narrativas. 
              Tudo será anonimizado, então tranquilize o entrevistado. Seja sucinto, fale pouco. Pergunte o que ele faz antes de começar. 
      
              Seu trabalho não é sugerir soluções, apenas coletar histórias.
            `,
            voice: "ash", // Definindo a voz do assistente
            turn_detection: {
              type: "server_vad",
              silence_duration_ms: 800, // Configuração da duração do silêncio
              threshold: 0.5,
              prefix_padding_ms: 300,
            },
          },
        };
        dc.send(JSON.stringify(sessionUpdateEvent));
      });
      
      dc.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(event.data);
      
          if (message.type === "assistant.speaking") {
            setIsAssistantSpeaking(true); // Ativa o brilho quando o assistente está falando
          } else if (message.type === "assistant.silence") {
            setIsAssistantSpeaking(false); // Desativa o brilho quando o assistente para de falar
          }
        } catch (error) {
          console.error("Erro ao processar mensagem do DataChannel:", error);
        }
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

      const combinedRecorder = new MediaRecorder(destination.stream, {
        mimeType: "audio/webm",
      });

      const combinedChunks = [];
      combinedRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          combinedChunks.push(e.data);
        }
      };
      combinedRecorder.onstop = () => {
        const blob = new Blob(combinedChunks, { type: "audio/webm" });
        const localUrl = URL.createObjectURL(blob);
        setCombinedDownloadUrl(localUrl);
      };

      combinedRecorder.start();
      combinedRecorderRef.current = combinedRecorder;

      setIsConnected(true);
    } catch (error) {
      console.error("Erro ao iniciar sessão:", error);
    }
  }

  function endInterview() {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    if (
      combinedRecorderRef.current &&
      combinedRecorderRef.current.state === "recording"
    ) {
      combinedRecorderRef.current.stop();
      combinedRecorderRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    setIsConnected(false);
    setIsAssistantSpeaking(false);
  }

  return (
    <div style={styles.container}>
      <div
        className={isAssistantSpeaking ? "logo-speaking" : "logo-default"}
        style={{
          ...styles.logoContainer,
          boxShadow: isAssistantSpeaking
            ? "0 0 20px 5px rgba(0, 255, 255, 0.8)"
            : "none",
          transition: "box-shadow 0.3s ease-in-out",
        }}
      >
        <TargetTealLogo isSpeaking={isAssistantSpeaking} />
      </div>

      <div style={styles.content}>
        <h1 style={styles.title}>Cardus Realtime Interview</h1>

        <div
          style={{
            marginBottom: "1rem",
            display: "flex",
            gap: "1rem",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
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

          {/* Botão temporário para alternar brilho */}
          <button
            onClick={() => setIsAssistantSpeaking((prev) => !prev)}
            style={{
              ...styles.button,
              backgroundColor: isAssistantSpeaking ? "#AAFFAA" : "#AAAAFF",
            }}
          >
            Alternar Brilho
          </button>
        </div>

        <div style={styles.interviewerBox}>
          <h3 style={{ marginBottom: "1rem" }}>Versão Alpha</h3>
          <p>
            Este exemplo grava a entrevista em um arquivo
            de áudio (.webm) que pode ser baixado após a entrevista.
          </p>
        </div>

        {combinedDownloadUrl && (
          <div style={styles.downloadContainer}>
            <h3>Gravação da Entrevista:</h3>
            <audio
              controls
              src={combinedDownloadUrl}
              style={{ display: "block", marginTop: "0.5rem" }}
            />
            <a href={combinedDownloadUrl} download="Recording.webm">
              Baixar Recording.webm
            </a>
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
    textAlign: "left",
  },
};

// Add these styles to your CSS file
/* 
.logo-speaking {
  box-shadow: 0 0 20px 5px rgba(0, 255, 255, 0.8);
  transition: box-shadow 0.3s ease-in-out;
}

.logo-default {
  transition: box-shadow 0.3s ease-in-out;
}
*/
