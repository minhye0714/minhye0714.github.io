# frozen_string_literal: true

# jekyll-archives creates pages for categories used by posts. Add the missing
# preset categories so every sidebar link works before its first post exists.
module Jekyll
  class PresetCategories < Generator
    safe true
    priority :lowest

    def generate(site)
      groups = site.data.fetch('sidebar_categories', [])
      names = groups.flat_map { |group| [group.fetch('name'), *group.fetch('children', [])] }.uniq

      names.each do |name|
        next if site.categories.key?(name)

        archive = Archives::Archive.new(site, name, 'category', [])
        next if site.pages.any? { |page| page.url == archive.url }

        site.pages << archive
        site.config.fetch('archives', []) << archive
      end
    end
  end
end
