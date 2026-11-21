-- Products inside one category used to be ordered alphabetically, so a café
-- could not put «لاته» above «آمریکانو». The new column holds the manual
-- order; existing rows keep their current alphabetical sequence, so upgrading
-- does not shuffle a menu that is already live.
ALTER TABLE products ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

UPDATE products
   SET sort_order = (
     SELECT COUNT(*)
       FROM products AS peer
      WHERE peer.category_id = products.category_id
        AND peer.deleted_at IS NULL
        AND (peer.name_fa < products.name_fa
             OR (peer.name_fa = products.name_fa AND peer.created_at <= products.created_at))
   );

CREATE INDEX IF NOT EXISTS idx_products_sort ON products (category_id, sort_order);
