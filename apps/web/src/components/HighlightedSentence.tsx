export function HighlightedSentence({ sentence, expression }: { sentence: string; expression: string }) {
  const needle = expression.trim();
  if (!needle) return <>{sentence}</>;
  const index = sentence.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (index < 0) return <>{sentence}</>;
  return <>{sentence.slice(0, index)}<mark>{sentence.slice(index, index + needle.length)}</mark>{sentence.slice(index + needle.length)}</>;
}
