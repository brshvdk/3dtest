import { useState } from "react";
import { useAppStore } from "../state/store";
import { buildShareUrl, encodeProject } from "../domain/share";
import { Icon, IconButton, toast } from "../ui/kit";
import { useTheme } from "./theme";

const MODULES = [
  { id: "skirting", name: "Плинтус", ready: true },
  { id: "floor", name: "Пол", ready: false },
  { id: "paint", name: "Покраска", ready: false },
  { id: "wallpaper", name: "Обои", ready: false },
  { id: "tile", name: "Плитка", ready: false },
];

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function Header() {
  const projectName = useAppStore((s) => s.project.name);
  const renameProject = useAppStore((s) => s.renameProject);
  const canUndo = useAppStore((s) => s.past.length > 0);
  const canRedo = useAppStore((s) => s.future.length > 0);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const newProject = useAppStore((s) => s.newProject);
  const { dark, toggle } = useTheme();
  const [editing, setEditing] = useState(false);

  const share = async () => {
    try {
      const enc = await encodeProject(useAppStore.getState().project);
      const url = buildShareUrl(enc);
      if (await copyText(url)) toast("Ссылка на проект скопирована");
      else window.prompt("Скопируйте ссылку на проект:", url);
    } catch {
      toast("Не удалось создать ссылку", "warning");
    }
  };

  const startNew = () => {
    if (
      window.confirm(
        "Начать новый проект? Текущий можно будет вернуть кнопкой «Отменить».",
      )
    ) {
      newProject();
      toast("Создан новый проект", "info");
    }
  };

  return (
    <header className="app-header">
      <div className="app-header__brand">
        <div className="brand-mark" aria-hidden>
          <Icon name="ruler" size={18} strokeWidth={2} />
        </div>
        <div className="brand-text">
          <span className="brand-name">Мерка</span>
          <span className="brand-sub">замер и расчёт материалов</span>
        </div>
      </div>

      <nav className="app-header__modules" aria-label="Материалы">
        {MODULES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`module-tab${m.ready ? " is-active" : ""}`}
            disabled={!m.ready}
            title={m.ready ? undefined : "Скоро"}
            aria-current={m.ready ? "page" : undefined}
          >
            {m.name}
            {!m.ready ? <span className="module-tab__soon">скоро</span> : null}
          </button>
        ))}
      </nav>

      <div className="app-header__project">
        {editing ? (
          <input
            className="project-name-input"
            autoFocus
            defaultValue={projectName}
            maxLength={60}
            aria-label="Название проекта"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== projectName) renameProject(v);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <button
            type="button"
            className="project-name"
            onClick={() => setEditing(true)}
            title="Переименовать проект"
          >
            <span>{projectName}</span>
            <Icon name="edit" size={14} />
          </button>
        )}
      </div>

      <div className="app-header__actions">
        <IconButton icon="undo" label="Отменить (Ctrl+Z)" onClick={undo} disabled={!canUndo} />
        <IconButton icon="redo" label="Повторить (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo} />
        <span className="app-header__sep" />
        <IconButton icon="file-new" label="Новый проект" onClick={startNew} />
        <IconButton icon="link" label="Поделиться ссылкой" onClick={share} />
        <IconButton icon="print" label="Печать / PDF" onClick={() => window.print()} />
        <IconButton icon={dark ? "sun" : "moon"} label={dark ? "Светлая тема" : "Тёмная тема"} onClick={toggle} />
      </div>
    </header>
  );
}
