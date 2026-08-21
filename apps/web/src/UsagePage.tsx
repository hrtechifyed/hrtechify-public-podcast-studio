import { PLATFORM_CREDIT } from "@hrtechify/shared";

const Rule = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="show-form-card" style={{ marginTop: 18 }}>
    <div className="form-heading">
      <div>
        <h2>{title}</h2>
        <div className="muted" style={{ lineHeight: 1.7 }}>{children}</div>
      </div>
    </div>
  </section>
);

export function UsagePage() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">HRTechify</div>
          <div className="brand">Podcast Studio</div>
        </div>
        <a className="secondary-action compact" href="/">Back to Studio</a>
      </header>

      <main className="shows-page" style={{ maxWidth: 980, margin: "0 auto" }}>
        <section className="shows-heading">
          <div>
            <p className="eyebrow">Usage & processing</p>
            <h1>Free to use does not mean unlimited server processing.</h1>
            <p>
              HRTechify Podcast Studio is deliberately designed so public usage does not require paid final-rendering infrastructure. Heavy final generation happens on the user&apos;s own device.
            </p>
          </div>
        </section>

        <Rule title="Final generation runs on your device">
          <p>When you create the final podcast, your browser downloads the source and approved supporting files from the storage account you connected, then processes them locally on your computer.</p>
          <p><strong>Your computer does the heavy work.</strong> Generation speed therefore depends on your processor, available memory, browser and the length of the episode. Keep the tab open until generation finishes.</p>
          <p>Closing the tab, putting the device to sleep, running out of memory or losing connectivity can interrupt a generation. You can resume by starting generation again; your immutable original is not changed.</p>
        </Rule>

        <Rule title="No paid server-rendering fallback">
          <p>HRTechify does not use a paid Cloudflare Container or paid server-render farm for final podcast generation. It does not automatically move a job to paid server compute when a device is slow.</p>
          <p>The product is configured around free-tier platform services. If a free allowance or platform limit is reached, the affected feature may pause, return an error or become temporarily unavailable rather than intentionally switching to paid overage.</p>
        </Rule>

        <Rule title="What may still use a free platform allowance">
          <p>Account/API requests use Cloudflare Workers and D1. Optional edit analysis can use Workers AI, and optional brand-background removal can use Cloudflare Images.</p>
          <p>Those features are not a substitute for final rendering. If their available free capacity is exhausted, the Studio should fail clearly and preserve the original rather than silently purchasing extra processing.</p>
        </Rule>

        <Rule title="Your files stay in your storage">
          <p>Permanent originals and completed outputs remain in the Google Drive or Dropbox connection assigned to the show. HRTechify stores workflow and ownership metadata in D1, not a permanent duplicate podcast-media library.</p>
          <p>If saving a generated result back to connected storage fails, the Studio can keep the locally generated files available for direct download during that browser session so the processing effort is not automatically lost.</p>
        </Rule>

        <Rule title="What the browser downloads for generation">
          <p>The browser receives only authenticated same-origin download routes for files that belong to the signed-in user and the show&apos;s assigned storage connection. Google Drive and Dropbox refresh tokens remain server-side.</p>
          <p>The browser also downloads a pinned FFmpeg WebAssembly runtime from jsDelivr. That download is program code used to process media locally. Your podcast source, transcript timing, MP3 or MP4 is not sent to jsDelivr.</p>
        </Rule>

        <Rule title="Original recording and approval rules">
          <p>The original recording remains immutable. Only edit ranges that you explicitly approved are removed from the generated version. Technical processing must preserve words, pitch and speaking speed outside those approved ranges.</p>
          <p>The selected curated HRTechify template is used for the final video, and <strong>{PLATFORM_CREDIT}</strong> remains part of the final template.</p>
        </Rule>

        <Rule title="Practical device guidance">
          <p>For best results, use a current desktop browser, close unnecessary heavy applications, keep enough free memory available and keep the device connected to power for longer episodes.</p>
          <p>A slower computer can still work, but generation may take longer. A device with too little memory may be unable to finish a large episode locally.</p>
        </Rule>
      </main>

      <footer style={{ justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 16 }}>
          <a className="text-button" href="/">Back to Studio</a>
          <a className="text-button" href="/privacy">Privacy</a>
        </div>
        <span>{PLATFORM_CREDIT}</span>
      </footer>
    </div>
  );
}
