import { BaseScraper } from "./base.scraper.js";
import { ScraperResult } from "./types.js";
export declare class PatheScraper extends BaseScraper {
    readonly name = "pathe";
    private browser;
    private context;
    private fetchViaHttp;
    private fetchDayViaNextData;
    private groupShowtimes;
    private launchBrowser;
    private closeBrowser;
    private fetchViaPlaywright;
    private fetchProgramme;
    scrape(): Promise<ScraperResult>;
}
//# sourceMappingURL=pathe.scraper.d.ts.map