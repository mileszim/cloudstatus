"use client";

/**
 * One-click boilerplate for the incident body. Fills the textarea rather than
 * replacing a controlled value, so the field stays a plain uncontrolled input
 * that the surrounding server-action form can post normally.
 */
export function TemplatePicker({
  targetId,
  templates,
}: {
  targetId: string;
  templates: Array<{ label: string; body: string }>;
}) {
  function apply(body: string) {
    const field = document.getElementById(targetId) as HTMLTextAreaElement | null;
    if (!field) return;
    field.value = body;
    field.focus();
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-muted-foreground text-xs">Templates:</span>
      {templates.map((template) => (
        <button
          key={template.label}
          type="button"
          onClick={() => apply(template.body)}
          className="bg-secondary text-secondary-foreground hover:bg-accent rounded px-2 py-1 text-xs transition-colors"
        >
          {template.label}
        </button>
      ))}
    </div>
  );
}
