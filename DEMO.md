# OpenTab demo script

**URL:** https://opentab.health (works on a laptop or phone; allow location and microphone)

All numbers below came from the live app on 2026-10-25, which reads the hospitals' own CMS price files. Re-run each question right before presenting: if a hospital updates its file, the numbers can change, and the app will show the new file date.

## Pre-tested questions (dramatic, real spreads)

| # | Say this | What the app shows (San Francisco) | Why it lands |
|---|---|---|---|
| 1 | **"How much is a lower back MRI if I pay cash?"** | Cash price **$2,218 at UCSF Medical Center** vs **$6,944 at Zuckerberg SF General**. Spread **$4,726**, and the two hospitals are about 1.5 miles apart. UCSF lists 30% off its $7,392 list price; ZSFG's cash price *equals* its list price. | Same scan, same city, 3× the price |
| 2 | **"CT scan of my belly, I have Aetna"** | Aetna rate **$422 at John Muir Walnut Creek** vs **$4,741 at Alta Bates Summit**, an **11×** spread. 11 hospitals published no Aetna dollar rate. Insurer chips show where Aetna has contracts. | Insurance doesn't mean a fair price |
| 3 | **"How much is a knee MRI with Blue Shield?"** | Blue Shield rate **$337 at John Muir Walnut Creek** vs **$2,889 at Mills-Peninsula**, an **8.6×** spread. UCSF's rate is $436, *below* its $1,954 cash price. | Shows "your plan" vs. cash on every card |

Backup question: **"Chest CT cash price"**: $1,174 at UCSF vs $5,514 at Zuckerberg SF General (4.7×).

## Live "add any hospital" moment

- **Hospital:** **Salinas Valley Health Medical Center**. Type exactly that into **+ Add a hospital**.
- **Tested:** about 20 s by name only. Bright Data SERP finds the official site, the Apify Actor reads `cms-hpt.txt` and streams the price file, and the result is **1,568 prices for 32 procedures** indexed into Elastic.
- **Stages** light up live: Searching → Fetching → Parsing → Indexed.
- **Then:** tap the mic and say *"knee MRI cash price near Salinas"*. The map jumps to Salinas and the new hospital is in the comparison.
- **Honest-failure backup:** "Hazel Hawkins Memorial Hospital" ends with "Could not find a cms-hpt.txt price file index…". Use it to show we never fake data.

**Before presenting**, reset it if you rehearsed:
```
node --env-file=.env.local elastic/remove-hospital.mjs "Salinas Valley"
```

## 3-minute pitch

**0:00 Hook (20 s).**
"In San Francisco, the cash price for a lower back MRI is $2,218 at one hospital and $6,944 at another a mile and a half away. Hospitals are *legally required* to publish these prices, but nobody can read them: they're gigabyte-sized JSON and CSV files. OpenTab reads them for you." *(If you have a real personal story about a medical bill, use it here instead.)*

**0:20 Who (15 s).**
"OpenTab is for patients trying to save money on radiology when insurance doesn't work out: high deductibles, denied claims, out of network. Imaging is the most shoppable care there is."

**0:35 Demo 1, voice (45 s).**
1. Tap the mic and say question 1.
2. Point at the pins turning into price tags, green to red, while the answer is spoken.
3. Open the UCSF card: cash $2,218, list price, file date, and the **Source file ↗** link. "Every number links to the hospital's own file."

**1:20 Demo 2, insurance (30 s).**
1. Type question 2.
2. Point at the $422 vs $4,741 spread and the insurer chips.
3. Check "Only hospitals with published Aetna rates."
4. Say: "We say *likely in network, call to confirm*. We never claim more than the file says."

**1:50 Demo 3, live web data (40 s).**
1. Click **+ Add a hospital**, type "Salinas Valley Health Medical Center", and press Add.
2. While the stages run, say: "Bright Data finds the site and gets past blocks, our Apify Actor stream-parses the file at about 60 MB a second, Convex streams the status, and Elastic indexes it."
3. When it shows **Indexed**, ask about Salinas.
4. Optional: "Open the app anywhere in the US and it does this automatically for every hospital near you."

**2:30 How it's built (20 s).**
"Claude turns speech into a structured search. It can only pick codes and insurers from fixed lists, and it never produces a price: every dollar it says is checked against our computed numbers. Elastic Agent Builder runs the ES|QL tools, shared by the app, an AI agent and MCP. Cartesia does the voice."

**2:50 Close (10 s).**
"OpenTab: know the bill before you get the bill. It's live at opentab.health."

## 2-minute voice-first cut

1. **Hook** (15 s): the same as above, shorter.
2. **Mic → question 1** (40 s): the pins, the spoken answer, the source link.
3. **Mic → question 3** (30 s): "knee MRI with Blue Shield." Point out that UCSF's plan rate is below its cash price, and that the cards show both.
4. **Mic → "how about near Salinas?"** (20 s), after adding Salinas Valley live, or have it pre-added for the short cut.
5. **Safeguards and close** (15 s): no invented prices, a source on every number, no health data stored.

## Checklist (T−15 min)

- [ ] Open https://opentab.health on the demo device. Allow **location** and **microphone**. Turn the phone ringer and silent mode off, volume up.
- [ ] Run questions 1–3 once; numbers should match the table above, or note the new values.
- [ ] Reset Salinas Valley (command above) and confirm it doesn't appear in a "near Salinas" search.
- [ ] Have the backup ready: if Wi-Fi is bad, type the questions instead of speaking.
- [ ] Have the Apify Console (Actor runs) and Kibana Agent Builder open in tabs, in case judges want proof.
