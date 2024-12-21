//import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Make the request to create an ephemeral session with your standard key
    const openAiRes = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, // safe on server
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17",
        voice: "verse",
      }),
    });

    const data = await openAiRes.json();
    // data contains { client_secret: { value: "...", expires_at: ... }, ... }

    // Return ephemeral token to the client
    res.status(200).json(data);
  } catch (error) {
    console.error("Error creating ephemeral token:", error);
    res.status(500).json({ error: "Failed to create ephemeral token" });
  }
}
