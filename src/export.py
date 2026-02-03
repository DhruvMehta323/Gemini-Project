"""
Risk Data Export Module
Exports processed risk data in formats for routing and visualization
"""
import json
import geopandas as gpd
import pandas as pd
from pathlib import Path
from typing import Optional, Dict, Any
from datetime import datetime


class RiskExporter:
    """Export risk data in various formats for downstream consumers"""

    def __init__(self, output_dir: str = "output"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)

    def export_grid_geojson(
        self,
        grid_gdf: gpd.GeoDataFrame,
        filename: str = "grid_risk.geojson"
    ) -> str:
        """
        Export H3 grid risk as GeoJSON for map visualization

        Args:
            grid_gdf: GeoDataFrame with H3 hexagons
            filename: Output filename

        Returns:
            Path to exported file
        """
        output_path = self.output_dir / filename

        # Select columns for export
        export_cols = [
            "h3_cell", "risk_score", "risk_category", "crash_count",
            "total_severity", "total_injured", "total_killed",
            "center_lat", "center_lng", "geometry"
        ]

        export_gdf = grid_gdf[[c for c in export_cols if c in grid_gdf.columns]].copy()

        # Convert category to string for JSON
        if "risk_category" in export_gdf.columns:
            export_gdf["risk_category"] = export_gdf["risk_category"].astype(str)

        export_gdf.to_file(output_path, driver="GeoJSON")
        print(f"Exported grid GeoJSON: {output_path}")
        return str(output_path)

    def export_segments_geojson(
        self,
        segments_gdf: gpd.GeoDataFrame,
        filename: str = "segment_risk.geojson"
    ) -> str:
        """
        Export road segments as GeoJSON

        Args:
            segments_gdf: GeoDataFrame with street segments
            filename: Output filename

        Returns:
            Path to exported file
        """
        output_path = self.output_dir / filename
        segments_gdf.to_file(output_path, driver="GeoJSON")
        print(f"Exported segments GeoJSON: {output_path}")
        return str(output_path)

    def export_grid_json(
        self,
        grid_df: pd.DataFrame,
        filename: str = "grid_risk.json"
    ) -> str:
        """
        Export grid risk as plain JSON (no geometry) for routing API

        Args:
            grid_df: DataFrame with grid risk data
            filename: Output filename

        Returns:
            Path to exported file
        """
        output_path = self.output_dir / filename

        # Remove geometry, keep data
        export_df = grid_df.drop(columns=["geometry"], errors="ignore").copy()

        # Convert to records format
        records = export_df.to_dict("records")

        # Create lookup dict by h3_cell for fast access
        lookup = {r["h3_cell"]: r for r in records}

        output_data = {
            "metadata": {
                "type": "h3_grid_risk",
                "generated_at": datetime.now().isoformat(),
                "total_cells": len(records),
                "resolution": 9
            },
            "cells": lookup
        }

        with open(output_path, "w") as f:
            json.dump(output_data, f, indent=2, default=str)

        print(f"Exported grid JSON: {output_path}")
        return str(output_path)

    def export_time_patterns_json(
        self,
        hourly_df: pd.DataFrame,
        period_df: pd.DataFrame,
        cell_time_df: pd.DataFrame,
        filename: str = "time_patterns.json"
    ) -> str:
        """
        Export temporal risk patterns

        Args:
            hourly_df: Hourly risk data
            period_df: Period risk data
            cell_time_df: Cell-time combination data
            filename: Output filename

        Returns:
            Path to exported file
        """
        output_path = self.output_dir / filename

        # Build time patterns structure
        output_data = {
            "metadata": {
                "type": "time_patterns",
                "generated_at": datetime.now().isoformat()
            },
            "hourly": hourly_df.to_dict("records") if hourly_df is not None else [],
            "periods": period_df.to_dict("records") if period_df is not None else [],
            "cell_time_lookup": {}
        }

        # Create fast lookup for cell-time combinations
        if cell_time_df is not None:
            for _, row in cell_time_df.iterrows():
                cell = row["h3_cell"]
                period = row["time_period"]
                day_type = row["day_type"]

                if cell not in output_data["cell_time_lookup"]:
                    output_data["cell_time_lookup"][cell] = {}

                key = f"{period}_{day_type}"
                output_data["cell_time_lookup"][cell][key] = {
                    "crash_count": int(row["crash_count"]),
                    "time_risk_score": float(row["time_risk_score"]),
                    "global_risk_score": float(row["global_risk_score"])
                }

        with open(output_path, "w") as f:
            json.dump(output_data, f, indent=2, default=str)

        print(f"Exported time patterns JSON: {output_path}")
        return str(output_path)

    def export_routing_api_format(
        self,
        grid_df: pd.DataFrame,
        time_df: pd.DataFrame,
        filename: str = "routing_risk_api.json"
    ) -> str:
        """
        Export combined data optimized for routing engine consumption

        This is the PRIMARY output for Person 2 (routing engineer)

        Format:
        {
            "cells": {
                "h3_cell_id": {
                    "base_risk": 45.2,
                    "crash_count": 12,
                    "time_modifiers": {
                        "morning_rush_weekday": 1.5,
                        "evening_rush_weekday": 1.8,
                        ...
                    }
                }
            }
        }
        """
        output_path = self.output_dir / filename

        cells = {}

        # Base risk from grid
        for _, row in grid_df.iterrows():
            cell_id = row["h3_cell"]
            cells[cell_id] = {
                "base_risk": float(row["risk_score"]),
                "crash_count": int(row["crash_count"]),
                "total_severity": float(row["total_severity"]),
                "time_modifiers": {}
            }

        # Add time modifiers
        if time_df is not None:
            for _, row in time_df.iterrows():
                cell_id = row["h3_cell"]
                if cell_id in cells:
                    key = f"{row['time_period']}_{row['day_type']}"
                    # Calculate modifier relative to cell's base risk
                    base = cells[cell_id]["base_risk"]
                    if base > 0:
                        modifier = row["global_risk_score"] / base
                    else:
                        modifier = 1.0
                    cells[cell_id]["time_modifiers"][key] = round(modifier, 3)

        output_data = {
            "metadata": {
                "type": "routing_risk_api",
                "generated_at": datetime.now().isoformat(),
                "total_cells": len(cells),
                "h3_resolution": 9,
                "usage": "risk = base_risk * time_modifiers[period_daytype]"
            },
            "cells": cells
        }

        with open(output_path, "w") as f:
            json.dump(output_data, f, indent=2)

        print(f"Exported routing API JSON: {output_path}")
        return str(output_path)

    def export_intersections_geojson(
        self,
        intersections_gdf: gpd.GeoDataFrame,
        filename: str = "intersection_risk.geojson"
    ) -> str:
        """Export intersection risk points as GeoJSON"""
        output_path = self.output_dir / filename
        intersections_gdf.to_file(output_path, driver="GeoJSON")
        print(f"Exported intersections GeoJSON: {output_path}")
        return str(output_path)

    def export_all(
        self,
        grid_gdf: gpd.GeoDataFrame,
        segments_gdf: gpd.GeoDataFrame,
        intersections_gdf: gpd.GeoDataFrame,
        hourly_df: pd.DataFrame,
        period_df: pd.DataFrame,
        cell_time_df: pd.DataFrame
    ) -> Dict[str, str]:
        """
        Export all data formats at once

        Returns:
            Dict mapping format name to file path
        """
        exports = {}

        exports["grid_geojson"] = self.export_grid_geojson(grid_gdf)
        exports["segments_geojson"] = self.export_segments_geojson(segments_gdf)
        exports["intersections_geojson"] = self.export_intersections_geojson(intersections_gdf)

        # JSON exports need DataFrame without geometry
        grid_df = grid_gdf.drop(columns=["geometry"], errors="ignore")
        exports["grid_json"] = self.export_grid_json(grid_df)
        exports["time_patterns"] = self.export_time_patterns_json(
            hourly_df, period_df, cell_time_df
        )
        exports["routing_api"] = self.export_routing_api_format(grid_df, cell_time_df)

        print(f"\nAll exports complete. Files in: {self.output_dir}")
        return exports
