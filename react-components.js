// react-components.js
// React component templates for ORCA INSIGHT, mounted alongside the
// existing vanilla app.js -- no build step, no rewrite of anything that
// already works. Loaded via <script type="text/babel" src="react-components.js">,
// so Babel (loaded in index.html <head>) transpiles this JSX in-browser
// automatically once the page loads.
//
// HOW TO ADD A NEW TEMPLATE:
//   1. Paste the component's JSX/function body in below (strip any
//      Next.js-only bits: "use client", next/image, next/link, etc.
//      Plain React function components work as-is).
//   2. Add a mount point in index.html: <div id="reactMount-yourThing"></div>
//   3. At the bottom of this file, call:
//        ReactDOM.createRoot(document.getElementById('reactMount-yourThing'))
//          .render(<YourComponent someProp="value" />);
//   4. Add react-components.js to frontend.Dockerfile's COPY line (see below).
//
// Every mount is independent -- if one component errors, it won't take
// down app.js or any other mounted component.

function ExampleBadge() {
  const [count, setCount] = React.useState(0);
  return React.createElement(
    "button",
    {
      onClick: () => setCount(count + 1),
      style: {
        padding: "6px 12px",
        borderRadius: "8px",
        background: "rgba(6,182,212,0.15)",
        border: "1px solid rgba(6,182,212,0.4)",
        color: "#22d3ee",
        fontSize: "11px",
        fontFamily: "monospace",
        cursor: "pointer",
      },
    },
    "React is live \u2014 clicked " + count + " times"
  );
}

// -- Mounts. Add one line per template you drop in. --------------------

(function mountAll() {
  function mount(id, element) {
    var host = document.getElementById(id);
    if (!host) return; // mount point not on this page/tab -- skip quietly
    ReactDOM.createRoot(host).render(element);
  }

  mount("reactMount-example", React.createElement(ExampleBadge));

  // Example of the JSX form (same result as above, once Babel is
  // transpiling this file -- use whichever style the pasted template came in):
  // mount("reactMount-example", <ExampleBadge />);
})();
