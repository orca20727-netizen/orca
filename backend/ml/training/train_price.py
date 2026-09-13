"""
Train the MARKET PRICE model.

  species + month (season) + demand level  -->  market price (Rs/kg)

Deliberately does not see zone/ocean columns (see feature_engineering
docstring) -- price is a market signal, not an oceanographic one.

"Predicted price" / trend (item 10) is produced by calling this SAME
model twice at inference time: once for the current month (-> "current"
baseline, cross-checked against ORCA's live fisherman_market.json price)
and once for next month (-> "predicted"), then comparing the two to label
the trend INCREASING/DECREASING/STABLE. See ml/inference/predictor.py.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor

from ml.features.feature_engineering import build_price_features
from ml.training._common import (
    feature_importance, load_dataset, pick_best_regressor, save_metrics, save_model, split,
)


def main():
    df = load_dataset()
    X = build_price_features(df)
    y = df["market_price_per_kg"]

    X_train, X_val, y_train, y_val = split(X, y)

    candidates = {
        "RandomForest": RandomForestRegressor(n_estimators=200, max_depth=8, min_samples_leaf=4, random_state=42, n_jobs=-1),
        "GradientBoosting": GradientBoostingRegressor(n_estimators=150, max_depth=3, learning_rate=0.08, random_state=42),
    }
    best_name, best_model, all_results = pick_best_regressor(candidates, X_train, y_train, X_val, y_val)
    importances = feature_importance(best_model, list(X.columns))

    save_model(best_model, "price_model.pkl")
    payload = {
        "model_name": "price_model",
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
    path = save_metrics("price_model", payload)
    print(f"Selected {best_name} for price_model -- validation: {all_results[best_name]}")
    print(f"Saved model + metrics ({path})")


if __name__ == "__main__":
    main()
