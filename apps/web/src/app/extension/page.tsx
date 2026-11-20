import Link from "next/link";
import Page from "@/components/Page";

export const metadata = { title: "Install the extension · coPAYMe" };

export default function ExtensionPage() {
  return (
    <Page>
      <h1 className="ptitle">Install the extension</h1>
      <p className="psub">
        The extension puts a score beside every handle on X. It isn&apos;t on the Chrome Web Store yet (a listing needs a review that
        takes days), so you install it from a file. It takes about a minute.
      </p>

      <ol className="install">
        <li className="card">
          <span className="n">1</span>
          <div>
            <h3>Download it</h3>
            <p>Download the file and unzip it. You get a folder called coPAYMe-extension.</p>
            <a className="btn primary" href="/coPAYMe-extension.zip" download>
              Download coPAYMe-extension.zip
            </a>
          </div>
        </li>
        <li className="card">
          <span className="n">2</span>
          <div>
            <h3>Turn on developer mode</h3>
            <p>
              In Chrome, type <code>chrome://extensions</code> in the address bar, then switch on <b>Developer mode</b> in the top
              right.
            </p>
          </div>
        </li>
        <li className="card">
          <span className="n">3</span>
          <div>
            <h3>Load the folder</h3>
            <p>
              Press <b>Load unpacked</b> and choose the unzipped folder. coPAYMe appears in your extensions.
            </p>
          </div>
        </li>
        <li className="card">
          <span className="n">4</span>
          <div>
            <h3>Open X</h3>
            <p>
              Go to x.com. Scores show beside handles we know. On a profile we haven&apos;t scored, press <b>Scan picks</b>. To use{" "}
              <b>Watch</b> and <b>Copy trade</b>, <Link href="/signin" className="u">sign in</Link> on this site first.
            </p>
          </div>
        </li>
      </ol>

      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ fontSize: 16 }}>Good to know</h3>
        <ul className="notes">
          <li>It talks to coPAYMe running on your own computer, so the coPAYMe services need to be running.</li>
          <li>After an update, press <b>Reload</b> on the extension in <code>chrome://extensions</code>, then refresh the X tab.</li>
          <li>Copy trades are simulated for now. No real money moves.</li>
        </ul>
      </div>
    </Page>
  );
}
