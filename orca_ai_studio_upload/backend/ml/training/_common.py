"""Shared train/evaluate/save helpers used by every train_*.py script.

Not one of the named pipeline stages in its own right -- just the common
plumbing (model comparison, metric computation, joblib save, metrics.json
write) so each train_*.py script stays focused on *what* it trains rather
than repeating *how* to train and score it.
"""
import json
import os
import time

import joblib
import numpy as np
from sklearn.metrics import (
    accuracy_score, f1_score, mean_absolute_error,
    mean_squared_error, precision_score, r2_score, recall_score,
)
from sklearn.model_selection import train_test_split

MODELS_DIR = os.path.join(os.path.dirname(__file__), "..", "models")
DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "fishing_trips_demo.csv")


def split(X, y, test_size=0.2, seed=42, stratify=False):
    strat = y if stratify else None
    return train_test_split(X, y, test_size=test_size, random_state=seed, stratify=strat)


def regression_metrics(y_true, y_pred) -> dict:
    mae = float(mean_absolute_error(y_true, y_pred))
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    r2 = float(r2_score(y_true, y_pred))
    return {"mae": round(mae, 3), "rmse": round(rmse, 3), "r2": round(r2, 4)}


def classification_metrics(y_true, y_pred) -> dict:
    return {
        "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
        "precision": round(float(precision_score(y_true, y_pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_true, y_pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y_true, y_pred, zero_division=0)), 4),
    }


def pick_best_regressor(candidates: dict, X_train, y_train, X_val, y_val):
    """candidates: {name: sklearn_estimator}. Fits every candidate, scores
    each on the held-out validation split by R2 (higher is better -- the
    metric spec item 24 asks a regression model to report), and returns
    (best_name, best_fitted_model, {name: metrics}) so training scripts
    can save whichever one actually generalizes best instead of just
    picking the first thing that runs."""
    results = {}
    fitted = {}
    for name, model in candidates.items():
        t0 = time.time()
        model.fit(X_train, y_train)
        train_secs = time.time() - t0
        preds = model.predict(X_val)
        m = regression_metrics(y_val, preds)
        m["train_seconds"] = round(train_secs, 2)
        results[name] = m
        fitted[name] = model
    best_name = max(results, key=lambda n: results[n]["r2"])
    return best_name, fitted[best_name], results


def pick_best_classifier(candidates: dict, X_train, y_train, X_val, y_val):
    """Same idea as pick_best_regressor but for classifiers, selecting by
    F1 (more informative than raw accuracy when classes aren't balanced,
    which the species-suitability label isn't -- ~78% positive by
    construction in the demo generator)."""
    results = {}
    fitted = {}
    for name, model in candidates.items():
        t0 = time.time()
        model.fit(X_train, y_train)
        train_secs = time.time() - t0
        preds = model.predict(X_val)
        m = classification_metrics(y_val, preds)
        m["train_seconds"] = round(train_secs, 2)
        results[name] = m
        fitted[name] = model
    best_name = max(results, key=lambda n: results[n]["f1"])
    return best_name, fitted[best_name], results


def feature_importance(model, feature_names) -> dict:
    if not hasattr(model, "feature_importances_"):
        return {}
    importances = model.feature_importances_
    pairs = sorted(zip(feature_names, importances), key=lambda t: -t[1])
    return {name: round(float(val), 4) for name, val in pairs}


def save_model(model, filename: str):
    os.makedirs(MODELS_DIR, exist_ok=True)
    path = os.path.join(MODELS_DIR, filename)
    joblib.dump(model, path)
    return path


def save_metrics(name: str, payload: dict):
    os.makedirs(MODELS_DIR, exist_ok=True)
    path = os.path.join(MODELS_DIR, f"{name}_metrics.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    return path


def load_dataset():
    import pandas as pd
    df = pd.read_csv(DATA_PATH)
    return df
