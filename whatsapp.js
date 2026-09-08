// Adaptateur WhatsApp (transport).
//
// Modes :
//   - "simulation" : aucun envoi réel ; les messages sont affichés dans la console
//     et enregistrés dans l'application. Idéal pour tester sans compte.
//   - "http" : envoi réel via une API REST compatible WhatsApp Cloud API
//     (Meta, 360dialog, etc.). Variable d'environnement à configurer :
//       WHATSAPP_MODE=http
//       WHATSAPP_API_URL=https://.../messages
//       WHATSAPP_API_TOKEN=<jeton>
//       WHATSAPP_VERIFY_TOKEN=<jeton de webhook>
//
// Le secrétariat voit toutes les conversations dans l'app (vue « WhatsApp »).

const MODE = process.env.WHATSAPP_MODE || "simulation";

async function envoyer(to, texte) {
  if (MODE === "http") {
    const url = process.env.WHATSAPP_API_URL;
    const token = process.env.WHATSAPP_API_TOKEN;
    if (!url || !token) {
      throw new Error("WHATSAPP_API_URL / WHATSAPP_API_TOKEN non configurés.");
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: texte }
      })
    });
    if (!res.ok) {
      const corps = await res.text().catch(() => "");
      throw new Error("WhatsApp API " + res.status + (corps ? " : " + corps.slice(0, 200) : ""));
    }
    return true;
  }

  // Mode simulation : on marque l'envoi comme effectué.
  const resume = texte.replace(/\s+/g, " ").trim().slice(0, 120);
  console.log(`[whatsapp][simulation] → ${to} : ${resume}`);
  return true;
}

module.exports = { envoyer, mode: () => MODE };