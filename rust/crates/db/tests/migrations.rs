use cafeflow_db::{Database, DbConfig, DbDriver, SeedOptions};

fn config(root: &std::path::Path) -> DbConfig {
    DbConfig {
        driver: DbDriver::Sqlite,
        database_path: root.join("cafeflow.db"),
        database_url: None,
        pool_max: 1,
        auto_migrate: false,
        data_directory: root.to_path_buf(),
    }
}

#[tokio::test]
async fn fresh_sqlite_migrations_and_seed_are_idempotent() {
    let directory = tempfile::tempdir().unwrap();
    let database = Database::connect(&config(directory.path())).await.unwrap();

    let applied = database.migrate().await.unwrap();
    assert_eq!(applied.len(), 16);
    assert!(database.migrate().await.unwrap().is_empty());
    assert_eq!(database.table_count().await.unwrap(), 74);

    let options = SeedOptions {
        admin_username: "admin".to_string(),
        admin_password: "CafeFlow@1404".to_string(),
        demo_staff: false,
        demo_menu: false,
    };
    assert!(
        cafeflow_db::seed_database(&database, &options)
            .await
            .unwrap()
    );
    assert!(
        !cafeflow_db::seed_database(&database, &options)
            .await
            .unwrap()
    );
    let admin = database
        .find_user_by_username("admin")
        .await
        .unwrap()
        .unwrap();
    assert!(cafeflow_db::verify_password(
        "CafeFlow@1404",
        &admin.password_hash
    ));
    assert_eq!(
        database.roles_for_user(&admin.id).await.unwrap(),
        vec!["super_admin"]
    );
}

#[tokio::test]
async fn demo_menu_seed_creates_a_ready_to_order_catalog() {
    let directory = tempfile::tempdir().unwrap();
    let database = Database::connect(&config(directory.path())).await.unwrap();
    database.migrate().await.unwrap();

    let options = SeedOptions {
        admin_username: "admin".to_string(),
        admin_password: "CafeFlow@1404".to_string(),
        demo_staff: false,
        demo_menu: true,
    };
    assert!(
        cafeflow_db::seed_database(&database, &options)
            .await
            .unwrap()
    );
    assert!(
        !cafeflow_db::seed_database(&database, &options)
            .await
            .unwrap()
    );

    let row = sqlx::query(
        "SELECT (SELECT COUNT(*) FROM categories) AS categories,
                (SELECT COUNT(*) FROM products) AS products,
                (SELECT COUNT(*) FROM dining_tables) AS tables,
                (SELECT COUNT(*) FROM qr_codes) AS qr_codes,
                (SELECT COUNT(*) FROM option_groups) AS groups,
                (SELECT COUNT(*) FROM product_options) AS options",
    )
    .fetch_one(&database.pool)
    .await
    .unwrap();
    use sqlx::Row;
    assert_eq!(row.get::<i64, _>("categories"), 2);
    assert_eq!(row.get::<i64, _>("products"), 5);
    assert_eq!(row.get::<i64, _>("tables"), 3);
    assert_eq!(row.get::<i64, _>("qr_codes"), 3);
    assert_eq!(row.get::<i64, _>("groups"), 1);
    assert_eq!(row.get::<i64, _>("options"), 2);
}
