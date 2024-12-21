import { useState } from "react";

export default function Home() {
  const [isConnected, setIsConnected] = useState(false);

  async function startRealtimeSession() {
    try {
      // 1. Fetch ephemeral token from our /api/session endpoint
      const ephemeralResponse = await fetch("/api/session");
      const ephemeralData = await ephemeralResponse.json();
      const EPHEMERAL_KEY = ephemeralData.client_secret.value;

      // 2. Create a PeerConnection
      const pc = new RTCPeerConnection();

      // 3. Create an <audio> element to play remote audio
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      pc.ontrack = (event) => {
        audioEl.srcObject = event.streams[0];
      };

      // 4. Request mic permission and add track
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      pc.addTrack(micStream.getTracks()[0]);

      // 5. Data channel for sending text events to/from the model
      const dc = pc.createDataChannel("oai-events");
      dc.addEventListener("message", (event) => {
        console.log("Received from model:", event.data);
      });

      // 6. Create offer & set local description
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // 7. Send the offer SDP to OpenAI
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

      // 8. Set remote description with the answer
      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      // 9. Optional: send an example event to the model
      const exampleEvent = {
        type: "response.create",
        response: {
          modalities: ["text"],
          instructions: "Hello from Vercel-based WebRTC!",
        },
      };
      dc.send(JSON.stringify(exampleEvent));

      // Indicate we are connected
      setIsConnected(true);

      console.log("Connected to Realtime API via WebRTC");
    } catch (error) {
      console.error("Error starting session:", error);
    }
  }

  return (
    <div style={{ padding: "2rem" }}>
      <h1>Realtime Voice Agent Demo (Next.js on Vercel)</h1>
      <button onClick={startRealtimeSession} disabled={isConnected}>
        {isConnected ? "Connected!" : "Start Realtime Chat"}
      </button>
    </div>
  );
}
