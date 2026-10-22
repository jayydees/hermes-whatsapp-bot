// Shared synthetic week for the build and hermes-format tests.
const usd = (n) => (n >= 1e9 ? `$${Math.round(n / 1e8) / 10}B` : `$${Math.round(n / 1e6)}M`);
const data = {
  weekStart: "2026-11-09",
  weekEnd: "2026-11-15",
  money: {
    total_usd: 2.1e9, count: 14, pct_of_ytd: 3.2,
    top: [{ company: "Acme Robotics", amount_usd: 400e6, item_id: "d1" }, { company: "Lumen AI", amount_usd: 250e6, item_id: "d2" }],
    ytd_label: "AI funding", ytd_period: "Jan-Sep", ytd_source: "Crunchbase",
  },
  formatUSD: usd,
  dealNotes: { d1: "warehouse robots", d2: "legal search" },
  storyText: "OpenAI released Foo, a model that costs 40% less to run than Bar. Developers can use it through the API today.",
  sections: {
    policy: [
      { region: "USA", text: "Senate advances an AI chip export bill" },
      { region: "EU", text: "EU delays high-risk AI rules to 2028 (more time for firms)" },
    ],
    research: [{ text: "Labs show a small model matching a larger one (10x cheaper to train)" }],
    security: [{ text: "Acme chatbot leaks customer chats (two firms confirm)" }],
    physical_ai: [{ text: "Zed humanoid begins warehouse pilot (first paid deployment)" }],
    build: [{ text: "Foo API (OpenAI): 40% cheaper per token than Bar" }],
    business: [{ text: "Bank cuts support backlog with agents (60% fewer tickets)" }],
    invest: [{ text: "BigCo buys Lumen AI (consolidation in legal AI)" }],
  },
};
module.exports = { data, usd };
