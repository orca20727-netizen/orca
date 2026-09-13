"""
Train the CATCH PREDICTION model.

  Environmental conditions + location + season + gear + species +
  historical fishing patterns  -->  expected catch (kg)

Compares RandomForestRegressor and GradientBoostingRegressor on a held-out
validation split and keeps whichever generalizes better (by R2), per
spec item 6 ("compare multiple models... select based on validation
performance"). Saves the winner plus its real MAE/RMSE/R2 and real
feature importances -- nothing here is a hand-picked/hard-coded number.

Run: python3 -m backend.ml.training.train_catch  (from repo root)
  or: python3 backend/ml/training/train_catch.py
"""
import os
import sys

# backend/ itself is the import root in this codebase (main.py does
# `from api.routes import ...`, not `from backend.api.routes import ...`,
# because it always runs with backend/ as the working directory) -- match
# that convention so these scripts work the same way whether run directly
# or eventually imported from the running app.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor

from ml.features.feature_engineering import build_catch_features
from ml.training._common import (
    feature_importance, load_dataset, pick_best_regressor, save_metrics, save_model, split,
)


def main():
    df = load_dataset()
    X = build_catch_features(df)
    y = df["catch_kg"]

    X_train, X_val, y_train, y_val = split(X, y)

    candidates = {
        "RandomForest": RandomForestRegressor(n_estimators=200, max_depth=12, min_samples_leaf=3, random_state=42, n_jobs=-1),
        "GradientBoosting": GradientBoostingRegressor(n_estimators=200, max_depth=3, learning_rate=0.08, random_state=42),
    }
    best_name, best_model, all_results = pick_best_regressor(candidates, X_train, y_train, X_val, y_val)

    importances = feature_importance(best_model, list(X.columns))

    save_model(best_model, "catch_model.pkl")
    payload = {
        "model_name": "catch_model",
        "selected_algorithm": best_name,
        "candidates_compared": all_results,
        "validation_metrics": all_results[best_name],
        "feature_importance": importances,
        "feature_columns": list(X.columns),
        "training_rows": len(df),
        "training_data": "ORCA demonstration dataset (synthetic, see backend/ml/data/generate_demo_dataset.py)",
        "status": "DEMO MODEL",
        "disclaimer": "Model performance is based on demonstration data and does not represent real-world predictive accuracy.",
    }
    path = save_metrics("catch_model", payload)
    print(f"Selected {best_name} for catch_model -- validation: {all_results[best_name]}")
    print(f"Saved model + metrics ({path})")


if __name__ == "__main__":
    main()
