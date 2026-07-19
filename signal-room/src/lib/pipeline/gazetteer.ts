// Prediction-markets world gazetteer: the entities Signal Room should
// recognise on sight. Seeded from the intel corpus; grows via the entities
// table (this file is the bootstrap, the database is the living record).

export interface GazetteerEntry {
  kind: "person" | "company" | "platform" | "regulator" | "publication" | "other";
  name: string;
  aliases?: string[];
  flags?: {
    prospectType?: "speaker" | "sponsor" | "media";
    seniority?: "exec" | "senior" | "unknown";
    category?: string;
  };
}

export const GAZETTEER: GazetteerEntry[] = [
  // Venues / platforms
  { kind: "platform", name: "Kalshi", flags: { category: "prediction_market", prospectType: "sponsor" } },
  { kind: "platform", name: "Polymarket", aliases: ["Polymarkets"], flags: { category: "prediction_market", prospectType: "sponsor" } },
  { kind: "platform", name: "ForecastEx", flags: { category: "prediction_market", prospectType: "sponsor" } },
  { kind: "platform", name: "PredictIt", flags: { category: "prediction_market" } },
  { kind: "platform", name: "Manifold", aliases: ["Manifold Markets"], flags: { category: "prediction_market" } },
  { kind: "platform", name: "Metaculus", flags: { category: "forecasting" } },
  { kind: "platform", name: "Novig", aliases: ["Ludlow Exchange"], flags: { category: "prediction_market" } },
  { kind: "platform", name: "Sporttrade", flags: { category: "exchange" } },
  { kind: "platform", name: "Prophet X", aliases: ["ProphetX"], flags: { category: "exchange" } },
  { kind: "platform", name: "Augur", flags: { category: "crypto" } },
  { kind: "platform", name: "Azuro", flags: { category: "crypto" } },
  { kind: "platform", name: "Drift", aliases: ["Drift Protocol", "BET by Drift"], flags: { category: "crypto" } },
  { kind: "platform", name: "Limitless", aliases: ["Limitless Exchange"], flags: { category: "crypto" } },
  { kind: "platform", name: "Myriad", aliases: ["Myriad Markets"], flags: { category: "crypto" } },
  { kind: "platform", name: "TruthMarket", flags: { category: "crypto" } },
  { kind: "platform", name: "Base App", aliases: ["Base"], flags: { category: "crypto" } },

  // Distribution / brokers / exchanges
  { kind: "company", name: "Robinhood", flags: { category: "distribution", prospectType: "sponsor" } },
  { kind: "company", name: "Crypto.com", flags: { category: "distribution", prospectType: "sponsor" } },
  { kind: "company", name: "Interactive Brokers", aliases: ["IBKR"], flags: { category: "distribution" } },
  { kind: "company", name: "Webull", flags: { category: "distribution" } },
  { kind: "company", name: "Cboe", aliases: ["CBOE"], flags: { category: "exchange" } },
  { kind: "company", name: "CME", aliases: ["CME Group"], flags: { category: "exchange" } },
  { kind: "company", name: "ICE", aliases: ["Intercontinental Exchange"], flags: { category: "exchange" } },
  { kind: "company", name: "Nasdaq", flags: { category: "exchange" } },
  { kind: "company", name: "NYSE", aliases: ["New York Stock Exchange"], flags: { category: "exchange" } },
  { kind: "company", name: "Coinbase", flags: { category: "crypto" } },
  { kind: "company", name: "Kraken", flags: { category: "crypto" } },
  { kind: "company", name: "Gemini", flags: { category: "crypto" } },
  { kind: "company", name: "MoonPay", flags: { category: "infrastructure" } },
  { kind: "company", name: "Zero Hash", flags: { category: "infrastructure" } },

  // Sports / gaming adjacents
  { kind: "company", name: "DraftKings", flags: { category: "sports", prospectType: "sponsor" } },
  { kind: "company", name: "FanDuel", flags: { category: "sports", prospectType: "sponsor" } },
  { kind: "company", name: "Fanatics", flags: { category: "sports" } },
  { kind: "company", name: "Underdog", aliases: ["Underdog Fantasy"], flags: { category: "sports" } },
  { kind: "company", name: "PrizePicks", flags: { category: "sports" } },
  { kind: "company", name: "bet365", flags: { category: "sports" } },
  { kind: "company", name: "Flutter", aliases: ["Flutter Entertainment"], flags: { category: "sports" } },
  { kind: "company", name: "Entain", flags: { category: "sports" } },
  { kind: "company", name: "MGM", aliases: ["BetMGM", "MGM Resorts"], flags: { category: "sports" } },
  { kind: "company", name: "Caesars", flags: { category: "sports" } },

  // Institutions / liquidity
  { kind: "company", name: "Goldman Sachs", aliases: ["Goldman"], flags: { category: "institutional" } },
  { kind: "company", name: "JPMorgan", aliases: ["JP Morgan", "JPMorgan Chase"], flags: { category: "institutional" } },
  { kind: "company", name: "Morgan Stanley", flags: { category: "institutional" } },
  { kind: "company", name: "Citadel", aliases: ["Citadel Securities"], flags: { category: "liquidity" } },
  { kind: "company", name: "Jane Street", flags: { category: "liquidity" } },
  { kind: "company", name: "Susquehanna", aliases: ["SIG"], flags: { category: "liquidity" } },
  { kind: "company", name: "Jump Trading", aliases: ["Jump"], flags: { category: "liquidity" } },
  { kind: "company", name: "Wintermute", flags: { category: "liquidity" } },
  { kind: "company", name: "Virtu", aliases: ["Virtu Financial"], flags: { category: "liquidity" } },
  { kind: "company", name: "BlackRock", flags: { category: "institutional" } },

  // Tech
  { kind: "company", name: "Meta", aliases: ["Meta Platforms"], flags: { category: "tech" } },
  { kind: "company", name: "Google", aliases: ["Alphabet"], flags: { category: "tech" } },
  { kind: "company", name: "Apple", flags: { category: "tech" } },
  { kind: "company", name: "X Corp", flags: { category: "tech" } },
  { kind: "company", name: "OpenAI", flags: { category: "tech" } },
  { kind: "company", name: "xAI", flags: { category: "tech" } },

  // Regulators / official
  { kind: "regulator", name: "CFTC", aliases: ["Commodity Futures Trading Commission"] },
  { kind: "regulator", name: "SEC", aliases: ["Securities and Exchange Commission"] },
  { kind: "regulator", name: "FINRA" },
  { kind: "regulator", name: "DOJ", aliases: ["Department of Justice"] },
  { kind: "regulator", name: "FCA", aliases: ["Financial Conduct Authority"] },
  { kind: "regulator", name: "Gambling Commission", aliases: ["UKGC"] },
  { kind: "regulator", name: "New Jersey DGE", aliases: ["NJ DGE", "Division of Gaming Enforcement"] },
  { kind: "regulator", name: "Nevada Gaming Control Board", aliases: ["NGCB"] },

  // People (from the intel corpus; roles as publicly reported)
  { kind: "person", name: "Tarek Mansour", flags: { seniority: "exec", prospectType: "speaker" } },
  { kind: "person", name: "Luana Lopes Lara", flags: { seniority: "exec", prospectType: "speaker" } },
  { kind: "person", name: "Shayne Coplan", flags: { seniority: "exec", prospectType: "speaker" } },
  { kind: "person", name: "John Phillips", flags: { seniority: "exec" } },
  { kind: "person", name: "Jesse Pollak", flags: { seniority: "exec" } },
  { kind: "person", name: "Rebecca Kossnick", flags: { seniority: "exec", prospectType: "speaker" } },
  { kind: "person", name: "Vlad Tenev", flags: { seniority: "exec" } },
  { kind: "person", name: "Brian Armstrong", flags: { seniority: "exec" } },
  { kind: "person", name: "Caroline Pham", flags: { seniority: "exec" } },
  { kind: "person", name: "Paul Atkins", flags: { seniority: "exec" } },
  { kind: "person", name: "Nate Silver", flags: { prospectType: "media" } },
  { kind: "person", name: "Maria Bartiromo", flags: { prospectType: "media" } },
  { kind: "person", name: "Stuart Crowley", flags: { seniority: "exec" } },

  // Publications / media
  { kind: "publication", name: "Bloomberg", flags: { prospectType: "media" } },
  { kind: "publication", name: "Reuters", flags: { prospectType: "media" } },
  { kind: "publication", name: "Wall Street Journal", aliases: ["WSJ"], flags: { prospectType: "media" } },
  { kind: "publication", name: "Financial Times", aliases: ["FT"], flags: { prospectType: "media" } },
  { kind: "publication", name: "The Block", flags: { prospectType: "media" } },
  { kind: "publication", name: "Decrypt", flags: { prospectType: "media" } },
  { kind: "publication", name: "PANews", flags: { prospectType: "media" } },
  { kind: "publication", name: "CoinDesk", flags: { prospectType: "media" } },
  { kind: "publication", name: "Cointelegraph", flags: { prospectType: "media" } },
  { kind: "publication", name: "Axios", flags: { prospectType: "media" } },
  { kind: "publication", name: "Semafor", flags: { prospectType: "media" } },
  { kind: "publication", name: "Vanity Fair", flags: { prospectType: "media" } },
  { kind: "publication", name: "60 Minutes", aliases: ["CBS News"], flags: { prospectType: "media" } },

  // Events / orgs
  { kind: "other", name: "NEXTPredict", aliases: ["NEXT Predict"] },
  { kind: "other", name: "NEXT.io", aliases: ["NEXT"] },
];
