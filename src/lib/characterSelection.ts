import type {
  TournamentCharacterCategory,
  TournamentCharacterSelectionConfig,
} from "./types";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeList(values: string[]): string[] {
  const unique = new Set<string>();
  for (const raw of values) {
    const name = raw.trim();
    if (!name) continue;
    unique.add(name);
  }
  return [...unique];
}

export function normalizeCharacterSelectionConfig(
  mode: "free_input" | "list_selection",
  config: TournamentCharacterSelectionConfig | null | undefined,
  fallbackListName: string | null,
  fallbackList: string[]
): TournamentCharacterSelectionConfig {
  if (mode === "free_input") {
    return {
      categories: [
        {
          category_id: "free_input",
          category_name: "使用キャラクター",
          list_name: null,
          list: [],
          min_select: 1,
          max_select: 1,
          forbid_duplicate_item: false,
        },
      ],
      total_min_select: 1,
      total_max_select: 1,
    };
  }

  const inputCategories = config?.categories?.length
    ? config.categories
    : [
        {
          category_id: "category_1",
          category_name: "カテゴリ1",
          list_name: fallbackListName,
          list: fallbackList,
          min_select: 1,
          max_select: 1,
          forbid_duplicate_item: false,
        },
      ];

  const categories: TournamentCharacterCategory[] = inputCategories
    .slice(0, 3)
    .map((cat, index) => {
      const categoryId = cat.category_id?.trim() || `category_${index + 1}`;
      const categoryName = cat.category_name?.trim() || `カテゴリ${index + 1}`;
      const list = normalizeList(cat.list ?? []);
      const maxByList = list.length > 0 ? list.length : 1;
      const maxSelect = clamp(Math.floor(cat.max_select || 1), 1, maxByList);
      const minSelect = clamp(Math.floor(cat.min_select || 1), 0, maxSelect);
      return {
        category_id: categoryId,
        category_name: categoryName,
        list_name: cat.list_name?.trim() || null,
        list,
        min_select: minSelect,
        max_select: maxSelect,
        forbid_duplicate_item: !!cat.forbid_duplicate_item,
      };
    })
    .filter((cat) => cat.category_name.length > 0);

  const ensuredCategories = categories.length > 0
    ? categories
    : [
        {
          category_id: "category_1",
          category_name: "カテゴリ1",
          list_name: fallbackListName,
          list: normalizeList(fallbackList),
          min_select: 1,
          max_select: 1,
          forbid_duplicate_item: false,
        },
      ];

  const sumMax = ensuredCategories.reduce((sum, cat) => sum + cat.max_select, 0);
  const sumMin = ensuredCategories.reduce((sum, cat) => sum + cat.min_select, 0);
  const totalMax = clamp(Math.floor(config?.total_max_select || sumMax), 1, sumMax);
  const totalMin = clamp(Math.floor(config?.total_min_select || sumMin), 0, totalMax);

  return {
    categories: ensuredCategories,
    total_min_select: totalMin,
    total_max_select: totalMax,
  };
}

export function flattenCharacterOptions(
  config: TournamentCharacterSelectionConfig | null | undefined,
  fallbackList: string[] = []
): string[] {
  const unique = new Set<string>();

  if (config?.categories?.length) {
    for (const category of config.categories) {
      for (const raw of category.list) {
        const name = raw.trim();
        if (name) unique.add(name);
      }
    }
  }

  if (unique.size === 0) {
    for (const raw of fallbackList) {
      const name = raw.trim();
      if (name) unique.add(name);
    }
  }

  return [...unique];
}
