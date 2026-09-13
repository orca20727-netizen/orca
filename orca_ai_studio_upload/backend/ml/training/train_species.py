"""
Train the SPECIES SUITABILITY model.

A binary classifier -- "is this species a good match for these zone/ocean
conditions this season?" -- trained per (zone-conditions, species, season)
row. At inference, ORCA runs all 5 known species through the model for the
SAME zone/season/conditions and ranks them by predicted probability
(*100), which is what item 8's "1. Mackerel — 91 / 2. Sardine — 83 / ..."
ranking actually is: five real forward passes of one classifier, not five
separately invented numbers.

predict_proba, not predict, is what the ranking is built from -- a hard
0/1 label would collapse ties and lose the ranking signal entirely.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier

from ml.features.feature_engineering import build_species_features
from ml.training._common import (
    feature_importance, load_dataset, pick_best_classifier, save_metrics, save_model, split,
)


def main():
    df = load_dataset()
    X = build_species_features(df)
    y = df["species_suitable_for_zone"]

    X_train, X_val, y_train, y_val = split(X, y, stratify=True)

    candidates = {
        "RandomForest": RandomForestClassifier(n_estimators=200, max_depth=8, min_samples_leaf=4, random_state=42, n_jobs=-1),
        "GradientBoosting": GradientBoostingClassifier(n_estimators=150, max_depth=3, learning_rate=0.1, random_state=42),
    }
    best_name, best_model, all_results = pick_best_classifier(candidates, X_train, y_train, X_val, y_val)
    importances = feature_importance(best_model, list(X.columns))

    save_model(best_model, "species_model.pkl")
    payload = {
        "model_name": "species_model",
        "selected_algorithm": best_name,
        "candidates_compared": all_results,
        "validation_metrics": all_results[best_name],
        "feature_importance": importances,
        "feature_columns": list(X.columns),
        "training_rows": len(df),
        "positive_rate": round(float(y.mean()), 4),
        "training_data": "ORCA demonstration dataset (synthetic, see backend/ml/data/generate_demo_dataset.py)",
        "status": "DEMO MODEL",
        "disclaimer": "Model performance is based on demonstration data and does not represent real-world predictive accuracy.",
        "note": "Species ranking scores are this classifier's predict_proba() for each of the 5 known species run through the SAME zone/season conditions, sorted descending -- not independently generated numbers.",
    }
    path = save_metrics("species_model", payload)
    print(f"Selected {best_name} for species_model -- validation: {all_results[best_name]}")
    print(f"Saved model + metrics ({path})")


if __name__ == "__main__":
    main()
