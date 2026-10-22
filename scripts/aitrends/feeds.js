// Feed list for the weekly "AI This Week" report. Every URL here was verified working.
// Names are unique: they double as the raw-archive file name (raw/YYYY-MM-DD/<name>.xml.gz).
// section_hint is one of: money, story, launches, policy, research, security, physical_ai, deals.

function gnews(query) {
  const q = encodeURIComponent(query).replace(/%20/g, "+");
  return "https://news.google.com/rss/search?q=" + q + "&hl=en-US&gl=US&ceid=US:en";
}

const f = (name, url, section_hint, source_name) => ({ name, url, section_hint, source_name: source_name || name });

const FEEDS = [
  // money
  f("TechCrunch AI", "https://techcrunch.com/category/artificial-intelligence/feed/", "money", "TechCrunch"),
  f("Crunchbase News", "https://news.crunchbase.com/feed/", "money"),
  f("Inc42", "https://inc42.com/feed", "money"),
  f("Entrackr", "https://entrackr.com/rss", "money"),
  f("Indian Startup News", "https://indianstartupnews.com/rss", "money"),
  f("Google News Funding", gnews("AI startup raises funding when:7d"), "money", "Google News"),

  // story + launches
  f("The Verge", "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", "story"),
  f("Ars Technica", "https://arstechnica.com/ai/feed/", "story"),
  f("The Decoder", "https://the-decoder.com/feed/", "story"),
  f("MIT Tech Review", "https://www.technologyreview.com/topic/artificial-intelligence/feed", "story"),
  f("OpenAI", "https://openai.com/news/rss.xml", "launches"),
  f("Google", "https://blog.google/technology/ai/rss/", "launches"),
  f("Mistral", "https://mistral.ai/rss.xml", "launches"),
  f("Hugging Face", "https://huggingface.co/blog/feed.xml", "launches"),
  f("NVIDIA", "https://blogs.nvidia.com/feed/", "launches"),
  f("Meta", "https://about.fb.com/news/feed/", "launches"),
  f("Microsoft", "https://blogs.microsoft.com/feed/", "launches"),
  f("Anthropic", "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml", "launches"),

  // policy
  f("UK Gov", "https://www.gov.uk/search/news-and-communications.atom?keywords=artificial+intelligence", "policy"),
  f("US Federal Register", "https://www.federalregister.gov/api/v1/documents.rss?conditions[term]=artificial+intelligence", "policy"),
  f("Politico EU", "https://www.politico.eu/feed/", "policy"),
  f("EU Commission", "https://digital-strategy.ec.europa.eu/en/rss.xml", "policy"),
  f("MediaNama", "https://www.medianama.com/feed/", "policy"),
  f("Google News AI Regulation", gnews("AI regulation when:7d"), "policy", "Google News"),

  // research
  f("HF Daily Papers", "https://papers.takara.ai/api/feed", "research"),
  f("Google Research", "https://research.google/blog/rss/", "research"),

  // security
  f("The Record", "https://therecord.media/feed", "security"),
  f("BleepingComputer", "https://www.bleepingcomputer.com/feed/", "security"),
  f("The Hacker News", "https://feeds.feedburner.com/TheHackersNews", "security"),
  f("The Register Security", "https://www.theregister.com/security/headlines.atom", "security"),
  f("Google News AI Security", gnews("AI jailbreak OR AI breach OR AI security flaw when:7d"), "security", "Google News"),

  // physical_ai
  f("The Robot Report", "https://www.therobotreport.com/feed/", "physical_ai"),
  f("TechCrunch Robotics", "https://techcrunch.com/category/robotics/feed/", "physical_ai", "TechCrunch"),
  f("IEEE Spectrum Robotics", "https://spectrum.ieee.org/feeds/topic/robotics.rss", "physical_ai"),
  f("Google News Physical AI", gnews("humanoid robot OR robotaxi when:7d"), "physical_ai", "Google News"),

  // deals
  f("Google News AI Deals", gnews("AI acquisition OR acquires AI startup when:7d"), "deals", "Google News"),
];

module.exports = { FEEDS };
