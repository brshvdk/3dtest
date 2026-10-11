import { useState } from "react";
import { useAppStore } from "../state/store";
import { buildShareUrl, encodeProject } from "../domain/share";
import { pluralize } from "../domain/units";
import { Icon, IconButton, MenuButton, toast, useIsMobile, type MenuEntry } from "../ui/kit";
import { useTheme } from "./theme";
import { openArchived, startNewProject, useArchive } from "./projects";

const MODULES = [
  { id: "skirting", name: "Плинтус", ready: true },
  { id: "floor", name: "Пол", ready: false },
  { id: "paint", name: "Покраска", ready: false },
  { id: "wallpaper", name: "Обои", ready: false },
  { id: "tile", name: "Плитка", ready: false },
];

const dateFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

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
  const projectId = useAppStore((s) => s.project.id);
  const renameProject = useAppStore((s) => s.renameProject);
  const canUndo = useAppStore((s) => s.past.length > 0);
  const canRedo = useAppStore((s) => s.future.length > 0);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const archive = useArchive();
  const isMobile = useIsMobile();
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

  const recent = archive.filter((e) => e.project.id !== projectId);
  const menu: MenuEntry[] = [
    { id: "new", label: "Новый проект", icon: "file-new", onSelect: () => void startNewProject() },
    { id: "rename", label: "Переименовать проект", icon: "edit", onSelect: () => setEditing(true) },
    ...(isMobile
      ? ([
          { id: "print", label: "Печать / PDF", icon: "print", onSelect: () => window.print() },
          {
            id: "theme",
            label: dark ? "Светлая тема" : "Тёмная тема",
            icon: dark ? "sun" : "moon",
            onSelect: toggle,
          },
        ] satisfies MenuEntry[])
      : []),
    ...(recent.length
      ? ([
          { id: "sep", separator: true },
          { id: "recent", heading: "Недавние проекты" },
          ...recent.map(
            (e): MenuEntry => ({
              id: `p-${e.project.id}`,
              label: e.project.name,
              hint: `${e.project.rooms.length} ${pluralize(e.project.rooms.length, [
                "комната",
                "комнаты",
                "комнат",
              ])} · ${dateFmt.format(e.project.updatedAt)}`,
              icon: "history",
              onSelect: () => openArchived(e.project.id),
            }),
          ),
        ] satisfies MenuEntry[])
      : []),
  ];

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
            onFocus={(e) => e.currentTarget.select()}
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
            title={`${projectName} — переименовать`}
            aria-label={`Проект «${projectName}», переименовать`}
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
        <IconButton icon="link" label="Поделиться ссылкой" onClick={share} />
        {!isMobile ? (
          <>
            <IconButton icon="print" label="Печать / PDF" onClick={() => window.print()} />
            <IconButton
              icon={dark ? "sun" : "moon"}
              label={dark ? "Светлая тема" : "Тёмная тема"}
              onClick={toggle}
            />
          </>
        ) : null}
        <MenuButton icon="more" label="Меню проекта" items={menu} />
      </div>
    </header>
  );
}
