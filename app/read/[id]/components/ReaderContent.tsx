import parse from "html-react-parser";
import type { Element } from "domhandler";
import { DeferredImage } from "./DeferredImage";
import { shouldDropNode, stripHtml, type ReadMessage } from "../lib/read-utils";

export function ReaderContent({
  message,
  view,
  sanitized,
  cleanedHtml,
}: {
  message: ReadMessage;
  view: "clean" | "original" | "text";
  sanitized: string;
  cleanedHtml: string;
}) {
  if (view === "text") {
    return (
      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
        {message.text || stripHtml(message.html ?? "") || message.snippet || ""}
      </pre>
    );
  }

  if (view === "clean") {
    if (!cleanedHtml.trim()) {
      return (
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
          {stripHtml(message.html ?? "") ?? message.snippet ?? ""}
        </pre>
      );
    }
    return (
      <div>
        {parse(cleanedHtml, {
          replace: (node) => {
            if (shouldDropNode(node)) return <></>;
            if (node.type === "tag" && node.name === "img") {
              const imgNode = node as Element;
              const src = imgNode.attribs?.src;
              const alt = imgNode.attribs?.alt;
              return <DeferredImage src={src} alt={alt} />;
            }
            return undefined;
          },
        })}
      </div>
    );
  }

  return <div>{parse(sanitized)}</div>;
}
