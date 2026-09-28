ALTER TABLE merchants
  ADD COLUMN menu_items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(menu_items) = 'array'),
  ADD COLUMN business_hours text NOT NULL DEFAULT '' CHECK (length(business_hours) <= 1000);
