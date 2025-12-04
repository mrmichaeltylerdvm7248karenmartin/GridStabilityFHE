// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract GridStabilityFHE is SepoliaConfig {
    struct EncryptedPMUData {
        uint256 id;
        euint32 encryptedVoltage;
        euint32 encryptedFrequency;
        euint32 encryptedFacilityId;
        uint256 timestamp;
    }
    
    struct DecryptedPMUData {
        uint256 voltage;
        uint256 frequency;
        string facilityId;
        bool isAnalyzed;
    }

    uint256 public dataCount;
    mapping(uint256 => EncryptedPMUData) public encryptedPMUData;
    mapping(uint256 => DecryptedPMUData) public decryptedPMUData;
    
    mapping(string => euint32) private encryptedFacilityStats;
    string[] private facilityList;
    
    mapping(uint256 => uint256) private requestToDataId;
    
    event DataSubmitted(uint256 indexed id, uint256 timestamp);
    event AnalysisRequested(uint256 indexed id);
    event DataAnalyzed(uint256 indexed id);
    
    modifier onlyOperator(uint256 dataId) {
        _;
    }
    
    function submitEncryptedPMUData(
        euint32 encryptedVoltage,
        euint32 encryptedFrequency,
        euint32 encryptedFacilityId
    ) public {
        dataCount += 1;
        uint256 newId = dataCount;
        
        encryptedPMUData[newId] = EncryptedPMUData({
            id: newId,
            encryptedVoltage: encryptedVoltage,
            encryptedFrequency: encryptedFrequency,
            encryptedFacilityId: encryptedFacilityId,
            timestamp: block.timestamp
        });
        
        decryptedPMUData[newId] = DecryptedPMUData({
            voltage: 0,
            frequency: 0,
            facilityId: "",
            isAnalyzed: false
        });
        
        emit DataSubmitted(newId, block.timestamp);
    }
    
    function requestStabilityAnalysis(uint256 dataId) public onlyOperator(dataId) {
        EncryptedPMUData storage data = encryptedPMUData[dataId];
        require(!decryptedPMUData[dataId].isAnalyzed, "Already analyzed");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(data.encryptedVoltage);
        ciphertexts[1] = FHE.toBytes32(data.encryptedFrequency);
        ciphertexts[2] = FHE.toBytes32(data.encryptedFacilityId);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.analyzeGridData.selector);
        requestToDataId[reqId] = dataId;
        
        emit AnalysisRequested(dataId);
    }
    
    function analyzeGridData(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 dataId = requestToDataId[requestId];
        require(dataId != 0, "Invalid request");
        
        EncryptedPMUData storage eData = encryptedPMUData[dataId];
        DecryptedPMUData storage dData = decryptedPMUData[dataId];
        require(!dData.isAnalyzed, "Already analyzed");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (uint256 voltage, uint256 frequency, string memory facilityId) = 
            abi.decode(cleartexts, (uint256, uint256, string));
        
        dData.voltage = voltage;
        dData.frequency = frequency;
        dData.facilityId = facilityId;
        dData.isAnalyzed = true;
        
        if (FHE.isInitialized(encryptedFacilityStats[dData.facilityId]) == false) {
            encryptedFacilityStats[dData.facilityId] = FHE.asEuint32(0);
            facilityList.push(dData.facilityId);
        }
        encryptedFacilityStats[dData.facilityId] = FHE.add(
            encryptedFacilityStats[dData.facilityId], 
            FHE.asEuint32(1)
        );
        
        emit DataAnalyzed(dataId);
    }
    
    function getDecryptedPMUData(uint256 dataId) public view returns (
        uint256 voltage,
        uint256 frequency,
        string memory facilityId,
        bool isAnalyzed
    ) {
        DecryptedPMUData storage d = decryptedPMUData[dataId];
        return (d.voltage, d.frequency, d.facilityId, d.isAnalyzed);
    }
    
    function getEncryptedFacilityStats(string memory facilityId) public view returns (euint32) {
        return encryptedFacilityStats[facilityId];
    }
    
    function requestFacilityStatsDecryption(string memory facilityId) public {
        euint32 stats = encryptedFacilityStats[facilityId];
        require(FHE.isInitialized(stats), "Facility not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(stats);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptFacilityStats.selector);
        requestToDataId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(facilityId)));
    }
    
    function decryptFacilityStats(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 facilityHash = requestToDataId[requestId];
        string memory facilityId = getFacilityFromHash(facilityHash);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 stats = abi.decode(cleartexts, (uint32));
    }
    
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
    
    function getFacilityFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < facilityList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(facilityList[i]))) == hash) {
                return facilityList[i];
            }
        }
        revert("Facility not found");
    }
    
    function calculateGridStabilityIndex() public view returns (uint256 stabilityIndex) {
        uint256 totalVoltageDeviation = 0;
        uint256 totalFrequencyDeviation = 0;
        uint256 count = 0;
        
        for (uint256 i = 1; i <= dataCount; i++) {
            if (decryptedPMUData[i].isAnalyzed) {
                totalVoltageDeviation += abs(int256(decryptedPMUData[i].voltage) - 220000); // 220kV nominal
                totalFrequencyDeviation += abs(int256(decryptedPMUData[i].frequency) - 5000); // 50Hz nominal (scaled)
                count++;
            }
        }
        
        if (count == 0) return 100; // Perfect stability if no data
        
        uint256 avgVoltageDeviation = totalVoltageDeviation / count;
        uint256 avgFrequencyDeviation = totalFrequencyDeviation / count;
        
        // Simplified stability index calculation (higher is better)
        return 100 - (avgVoltageDeviation / 1000 + avgFrequencyDeviation / 10);
    }
    
    function detectAnomalies(
        uint256 voltageThreshold,
        uint256 frequencyThreshold
    ) public view returns (string[] memory unstableFacilities) {
        uint256 count = 0;
        
        for (uint256 i = 1; i <= dataCount; i++) {
            if (decryptedPMUData[i].isAnalyzed && 
                (decryptedPMUData[i].voltage > voltageThreshold || 
                 decryptedPMUData[i].frequency > frequencyThreshold)) {
                count++;
            }
        }
        
        unstableFacilities = new string[](count);
        uint256 index = 0;
        for (uint256 i = 1; i <= dataCount; i++) {
            if (decryptedPMUData[i].isAnalyzed && 
                (decryptedPMUData[i].voltage > voltageThreshold || 
                 decryptedPMUData[i].frequency > frequencyThreshold)) {
                unstableFacilities[index] = decryptedPMUData[i].facilityId;
                index++;
            }
        }
        return unstableFacilities;
    }
    
    function abs(int256 x) private pure returns (uint256) {
        return x >= 0 ? uint256(x) : uint256(-x);
    }
    
    function predictCascadeRisk(
        string[] memory criticalFacilities
    ) public view returns (uint256 riskScore) {
        uint256 unstableCount = 0;
        
        for (uint256 i = 0; i < criticalFacilities.length; i++) {
            for (uint256 j = 1; j <= dataCount; j++) {
                if (decryptedPMUData[j].isAnalyzed && 
                    keccak256(abi.encodePacked(decryptedPMUData[j].facilityId)) == keccak256(abi.encodePacked(criticalFacilities[i])) &&
                    (decryptedPMUData[j].voltage > 250000 || decryptedPMUData[j].voltage < 190000 ||
                     decryptedPMUData[j].frequency > 5200 || decryptedPMUData[j].frequency < 4800)) {
                    unstableCount++;
                    break;
                }
            }
        }
        
        return (unstableCount * 100) / criticalFacilities.length;
    }
}