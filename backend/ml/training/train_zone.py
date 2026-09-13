"""
Train the FISHING ZONE model.

Unlike the catch model (which needs species/gear/boat/duration to predict
a specific trip's yield), the zone model answers a different question:
"how good are THESE ocean conditions for fishing right now, independent of
what gear/boat/species a fisherman brings?" -- so it's trained on the same
label (catch_kg) but deliberately restricted to zone/ocean/effort features
only (see feature_engineering.build_zone_features). That keeps it usable
to rank *candidate* zones before a species or gear has even been picked.

At inference time (see ml/inference/predictor.py) the raw regression
output for each candidate zone is min-max scaled across that request's
candidate zones into the 0-100 "Fishing Potential Score" the product
spec asks for (item 7) -- the model itself just needs to rank zones
correctly relative to each other, which R2/MAE below verifies it does.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor

from ml.features.feature_engineering import build_zone_features
from ml.training._common import (
    feature_importance, load_dataset, pick_best_regressor, save_metrics, save_model, split,
)


def main():
    df = load_dataset()
    X = build_zone_features(df)
    y = df["catch_kg"]

    X_train, X_val, y_train, y_val = split(X, y)

    candidates = {
        "RandomForest": RandomForestRegressor(n_estimators=200, max_depth=10, min_samples_leaf=4, random_state=42, n_jobs=-1),
        "GradientBoosting": GradientBoostingRegressor(n_estimators=200, max_depth=3, learning_rate=0.08, random_state=42),
    }
    best_name, best_model, all_results = pick_best_regressor(candidates, X_train, y_train, X_val, y_val)
    importances = feature_importance(best_model, list(X.columns))

    save_model(best_model, "zone_model.pkl")
    payload = {
        "model_name": "zone_model",
        "selected_algorithm": best_name,
        "candidates_compared": all_results,
        "validation_metrics": all_results[best_name],
        "feature_importance": importances,
        "feature_columns": list(X.columns),
        "training_rows": len(df),
        "training_data": "ORCA demonstration dataset (synthetic, see backend/ml/data/generate_demo_dataset.py)",
        "status": "DEMO MODEL",
        "disclaimer": "Model performance is based on demonstration data and does not represent real-world predictive accuracy.",
        "note": "Predicts a zone-conditions-only expected-catch proxy; the product-facing 0-100 Fishing Potential Score is this prediction min-max scaled across the candidate zones evaluated in a given request (see decision_engine).",
    }
    path = save_metrics("zone_model", payload)
    print(f"Selected {best_name} for zone_model -- validation: {all_results[best_name]}")
    print(f"Saved model + metrics ({path})")


if __name__ == "__main__":
    main()
