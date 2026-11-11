/** Shows a web page to the DM in their default browser. */
export interface BrowserPort {
  /**
   * Resolves once the page is handed to the browser; rejects with an Error
   * saying why when it cannot be.
   */
  showPage(url: string): Promise<void>;
}
