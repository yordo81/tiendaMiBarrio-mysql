export const dynamic = 'force-dynamic';
import { query } from '@/lib/db/mysql';
import { handle, ok } from '@/lib/api-helpers';

export const GET = handle(async () => {
  // Obtener categorías con productos activos
  const categories = await query<{
    id: string;
    name: string;
  }>('SELECT id, name FROM categories ORDER BY name');

  // Obtener productos activos con su categoría
  const products = await query<{
    id: string;
    name: string;
    description: string | null;
    category_id: string | null;
    sale_price: number;
    cost: number;
    stock: number;
    min_stock: number;
    unit: string;
    image_url: string | null;
    category_name: string | null;
  }>(`
    SELECT p.id, p.name, p.description, p.category_id,
      p.sale_price, p.cost, p.stock, p.min_stock, p.unit, p.image_url,
      c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.active = 1 AND p.stock > 0
    ORDER BY c.name, p.name
  `);

  // Agrupar productos por categoría
  const grouped: {
    category_id: string;
    category_name: string;
    products: typeof products;
  }[] = [];

  // Crear un map de categoría -> productos
  const categoryMap = new Map<string, typeof products>();
  const uncategorized: typeof products = [];

  for (const product of products) {
    const catId = product.category_id ?? 'uncategorized';
    if (catId === 'uncategorized') {
      uncategorized.push(product);
    } else {
      if (!categoryMap.has(catId)) categoryMap.set(catId, []);
      categoryMap.get(catId)!.push(product);
    }
  }

  // Armar el resultado en el orden de las categorías
  for (const cat of categories) {
    const prods = categoryMap.get(cat.id);
    if (prods && prods.length > 0) {
      grouped.push({
        category_id: cat.id,
        category_name: cat.name,
        products: prods,
      });
    }
  }

  // Agregar productos sin categoría al final
  if (uncategorized.length > 0) {
    grouped.push({
      category_id: '',
      category_name: 'Otros',
      products: uncategorized,
    });
  }

  return ok(grouped);
});
