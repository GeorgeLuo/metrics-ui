import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import type { EquationsTopicOption } from "@/lib/equations/topic-catalog";
import {
  filterEquationsTopics,
  organizeEquationsTopics,
  type EquationsTopicGroupBucket,
  type EquationsTopicOrderingScheme,
} from "@/lib/equations/topic-browser";
import {
  getSidebarSelectableItemClass,
  SIDEBAR_MICRO_COPY_CLASS,
  SIDEBAR_SECTION_KICKER_CLASS,
} from "./sidebar-pane-patterns";

type UseEquationsTopicBrowserStateArgs = {
  topicOptions: EquationsTopicOption[];
};

export type EquationsTopicBrowserState = {
  query: string;
  setQuery: (next: string) => void;
  orderingScheme: EquationsTopicOrderingScheme;
  setOrderingScheme: (next: EquationsTopicOrderingScheme) => void;
  filteredTopicOptions: EquationsTopicOption[];
  organizedTopicOptions: EquationsTopicGroupBucket<EquationsTopicOption>[];
  hasActiveFilter: boolean;
};

export type EquationsTopicFilterControlsProps = {
  query: string;
  onQueryChange: (next: string) => void;
  orderingScheme: EquationsTopicOrderingScheme;
  onOrderingSchemeChange: (next: EquationsTopicOrderingScheme) => void;
  filteredTopicCount: number;
  inlineEditTextClass: string;
};

export type EquationsTopicListProps = {
  organizedTopicOptions: EquationsTopicGroupBucket<EquationsTopicOption>[];
  selectedTopicId: string;
  onTopicSelect: (id: string) => void;
  isGroupedByType: boolean;
  hasMatches: boolean;
};

export type EquationsRecentTopicListProps = {
  recentTopicOptions: EquationsTopicOption[];
  selectedTopicId: string;
  onTopicSelect: (id: string) => void;
};

export type EquationsTopicBrowserProps = {
  topicOptions: EquationsTopicOption[];
  recentTopicOptions: EquationsTopicOption[];
  selectedTopicId: string;
  onTopicSelect: (id: string) => void;
  inlineEditTextClass: string;
};

export function useEquationsTopicBrowserState({
  topicOptions,
}: UseEquationsTopicBrowserStateArgs): EquationsTopicBrowserState {
  const [query, setQuery] = useState("");
  const [orderingScheme, setOrderingScheme] =
    useState<EquationsTopicOrderingScheme>("canonical");

  const filteredTopicOptions = useMemo(
    () => filterEquationsTopics(topicOptions, query),
    [query, topicOptions],
  );
  const organizedTopicOptions = useMemo(
    () => organizeEquationsTopics(filteredTopicOptions, orderingScheme),
    [filteredTopicOptions, orderingScheme],
  );
  const hasActiveFilter = query.trim().length > 0 || orderingScheme !== "canonical";

  return {
    query,
    setQuery,
    orderingScheme,
    setOrderingScheme,
    filteredTopicOptions,
    organizedTopicOptions,
    hasActiveFilter,
  };
}

export function EquationsTopicFilterControls({
  query,
  onQueryChange,
  orderingScheme,
  onOrderingSchemeChange,
  filteredTopicCount,
  inlineEditTextClass,
}: EquationsTopicFilterControlsProps) {
  const trimmedQuery = query.trim();

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        className={`${inlineEditTextClass} w-full placeholder:text-muted-foreground/35`}
        aria-label="Filter equations topics"
        placeholder="Filter by title, tag, or alias"
        data-hint="Search topics."
      />
      <div className="flex items-center gap-1">
        {([
          ["canonical", "Canonical"],
          ["types", "Types"],
        ] as const).map(([scheme, label]) => {
          const isActive = orderingScheme === scheme;
          return (
            <button
              key={scheme}
              type="button"
              className={[
                "rounded-md border px-2 py-1 text-[10px] uppercase tracking-[0.08em] transition-colors",
                isActive
                  ? "border-border bg-accent/45 text-foreground"
                  : "border-border/50 bg-background/20 text-muted-foreground hover:bg-accent/18 hover:text-foreground",
              ].join(" ")}
              aria-pressed={isActive}
              onClick={() => onOrderingSchemeChange(scheme)}
              data-hint={
                scheme === "canonical"
                  ? "Show topics in the canonical reading order without explicit type groupings."
                  : "Show topics grouped by standard type such as equations, derivations, and addenda."
              }
            >
              {label}
            </button>
          );
        })}
      </div>
      {trimmedQuery.length > 0 ? (
        <div className={SIDEBAR_MICRO_COPY_CLASS}>
          {`${filteredTopicCount} topic${filteredTopicCount === 1 ? "" : "s"} match the current filter.`}
        </div>
      ) : null}
    </div>
  );
}

export function EquationsTopicList({
  organizedTopicOptions,
  selectedTopicId,
  onTopicSelect,
  isGroupedByType,
  hasMatches,
}: EquationsTopicListProps) {
  return (
    <div className="flex flex-col gap-2">
      {organizedTopicOptions.map((bucket, bucketIndex) => (
        <div
          key={`${isGroupedByType ? "types" : "canonical"}-${bucket.group ?? "all"}-${bucketIndex}`}
          className="flex flex-col gap-1"
        >
          {isGroupedByType && bucket.label ? (
            <div className={SIDEBAR_SECTION_KICKER_CLASS}>{bucket.label}</div>
          ) : null}
          <div className="flex flex-col gap-1">
            {bucket.topics.map((option) => {
              const isActive = option.id === selectedTopicId;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={getSidebarSelectableItemClass(isActive)}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => onTopicSelect(option.id)}
                  data-hint={`Open topic "${option.label}".`}
                  title={option.description}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {!hasMatches ? (
        <div className={SIDEBAR_MICRO_COPY_CLASS}>No topics match the current filter.</div>
      ) : null}
    </div>
  );
}

export function EquationsRecentTopicList({
  recentTopicOptions,
  selectedTopicId,
  onTopicSelect,
}: EquationsRecentTopicListProps) {
  return (
    <div className="flex flex-col gap-1">
      {recentTopicOptions.map((option) => {
        const isActive = option.id === selectedTopicId;
        return (
          <button
            key={option.id}
            type="button"
            className={getSidebarSelectableItemClass(isActive)}
            aria-current={isActive ? "page" : undefined}
            onClick={() => onTopicSelect(option.id)}
            data-hint={`Reopen the recent topic "${option.label}".`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// Compatibility export for hot-reload cycles that still request the previous
// combined browser component. New code should use the separate filter/list APIs.
export function EquationsTopicBrowser({
  topicOptions,
  recentTopicOptions,
  selectedTopicId,
  onTopicSelect,
  inlineEditTextClass,
}: EquationsTopicBrowserProps) {
  const topicBrowserState = useEquationsTopicBrowserState({ topicOptions });

  return (
    <div className="flex flex-col gap-2">
      <EquationsTopicFilterControls
        query={topicBrowserState.query}
        onQueryChange={topicBrowserState.setQuery}
        orderingScheme={topicBrowserState.orderingScheme}
        onOrderingSchemeChange={topicBrowserState.setOrderingScheme}
        filteredTopicCount={topicBrowserState.filteredTopicOptions.length}
        inlineEditTextClass={inlineEditTextClass}
      />
      <EquationsTopicList
        organizedTopicOptions={topicBrowserState.organizedTopicOptions}
        selectedTopicId={selectedTopicId}
        onTopicSelect={onTopicSelect}
        isGroupedByType={topicBrowserState.orderingScheme === "types"}
        hasMatches={topicBrowserState.filteredTopicOptions.length > 0}
      />
      <EquationsRecentTopicList
        recentTopicOptions={recentTopicOptions}
        selectedTopicId={selectedTopicId}
        onTopicSelect={onTopicSelect}
      />
    </div>
  );
}
