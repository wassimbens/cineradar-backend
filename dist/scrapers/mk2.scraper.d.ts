import { BaseScraper } from "./base.scraper.js";
import { ScraperResult } from "./types.js";
export declare class Mk2Scraper extends BaseScraper {
    readonly name = "mk2";
    private browser;
    private context;
    private fetchViaHttp;
    private fetchDayViaNextData;
    private parseJsonLd;
    private groupShowtimes;
    private launchBrowser;
    private closeBrowser;
    private fetchViaPlaywright;
    private fetchProgramme;
    scrape(): Promise<ScraperResult>;
}
//# sourceMappingURL=mk2.scraper.d.ts.map